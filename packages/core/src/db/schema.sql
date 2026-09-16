CREATE TABLE IF NOT EXISTS niches (
  niche_id    VARCHAR PRIMARY KEY,
  name        VARCHAR NOT NULL,
  keywords    VARCHAR,
  taxonomy_id BIGINT,
  min_price   DOUBLE,
  max_price   DOUBLE,
  sort_on     VARCHAR NOT NULL DEFAULT 'score',
  created_at  TIMESTAMP NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id   VARCHAR PRIMARY KEY,
  niche_id      VARCHAR NOT NULL,
  started_at    TIMESTAMP NOT NULL,
  finished_at   TIMESTAMP,
  listing_count INTEGER NOT NULL DEFAULT 0,
  api_calls     INTEGER NOT NULL DEFAULT 0,
  status        VARCHAR NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS listings (
  listing_id        BIGINT PRIMARY KEY,
  shop_id           BIGINT,
  title             VARCHAR,
  description       VARCHAR,
  taxonomy_id       BIGINT,
  url               VARCHAR,
  original_creation_timestamp TIMESTAMP,
  created_timestamp TIMESTAMP,
  first_seen_at     TIMESTAMP NOT NULL,
  last_seen_at      TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS listing_observations (
  snapshot_id   VARCHAR NOT NULL,
  listing_id    BIGINT NOT NULL,
  price_amount  DOUBLE,
  currency_code VARCHAR,
  num_favorers  INTEGER,
  quantity      INTEGER,
  state         VARCHAR,
  observed_at   TIMESTAMP NOT NULL,
  PRIMARY KEY (snapshot_id, listing_id)
);

CREATE TABLE IF NOT EXISTS listing_tags (
  listing_id BIGINT NOT NULL,
  tag        VARCHAR NOT NULL,
  PRIMARY KEY (listing_id, tag)
);

CREATE TABLE IF NOT EXISTS shops (
  shop_id       BIGINT PRIMARY KEY,
  shop_name     VARCHAR,
  url           VARCHAR,
  first_seen_at TIMESTAMP NOT NULL,
  last_seen_at  TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_observations (
  snapshot_id          VARCHAR NOT NULL,
  shop_id              BIGINT NOT NULL,
  num_favorers         INTEGER,
  listing_active_count INTEGER,
  review_count         INTEGER,
  review_average       DOUBLE,
  observed_at          TIMESTAMP NOT NULL,
  PRIMARY KEY (snapshot_id, shop_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  review_id         VARCHAR PRIMARY KEY,
  listing_id        BIGINT,
  shop_id           BIGINT,
  rating            INTEGER,
  review_text       VARCHAR,
  language          VARCHAR,
  created_timestamp TIMESTAMP
);

CREATE TABLE IF NOT EXISTS taxonomy_nodes (
  taxonomy_id BIGINT PRIMARY KEY,
  name        VARCHAR,
  level       INTEGER,
  parent_id   BIGINT,
  full_path   VARCHAR
);

CREATE TABLE IF NOT EXISTS ai_insights (
  snapshot_id  VARCHAR NOT NULL,
  insight_type VARCHAR NOT NULL,
  payload_json VARCHAR NOT NULL,
  model        VARCHAR,
  created_at   TIMESTAMP NOT NULL,
  PRIMARY KEY (snapshot_id, insight_type)
);

CREATE TABLE IF NOT EXISTS http_cache (
  cache_key     VARCHAR PRIMARY KEY,
  response_json VARCHAR NOT NULL,
  fetched_at    TIMESTAMP NOT NULL,
  expires_at    TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limit_state (
  window_key            VARCHAR PRIMARY KEY,
  remaining_today       INTEGER,
  remaining_this_second INTEGER,
  updated_at            TIMESTAMP NOT NULL
);

-- =====================================================================
-- Analiz view'lari
-- =====================================================================

-- Ardisik iki gozlem arasinda gunluk favori artisi.
-- Ilk gozlemde (karsilastiracak onceki kayit yokken) NULL.
CREATE OR REPLACE VIEW v_listing_velocity AS
WITH ardisik AS (
  SELECT
    s.niche_id,
    o.snapshot_id,
    o.listing_id,
    o.observed_at,
    o.num_favorers,
    o.price_amount,
    -- Bir onceki SATIR degil, en az 1 saat oncesindeki EN YAKIN gozlem.
    --
    -- Neden: formul gune boldugu icin 5 dakikalik araliktaki tek bir favori
    -- artisi 288/gun gibi anlamsiz bir degere donusur. Ama "1 saatten kisaysa
    -- NULL" demek de yanlisti: art arda alinan fazladan bir cekim, eldeki
    -- gecerli olcumu kor ediyordu. Dogru tanim, karsilastirmayi yeterince
    -- eski bir gozlemle yapmak.
    LAST_VALUE(o.num_favorers) OVER w AS onceki_favori,
    LAST_VALUE(o.observed_at)  OVER w AS onceki_an
  FROM listing_observations o
  JOIN snapshots s ON s.snapshot_id = o.snapshot_id
  WINDOW w AS (
    PARTITION BY s.niche_id, o.listing_id
    ORDER BY o.observed_at
    RANGE BETWEEN UNBOUNDED PRECEDING AND INTERVAL 1 HOUR PRECEDING
  )
)
SELECT
  niche_id,
  snapshot_id,
  listing_id,
  observed_at,
  num_favorers,
  price_amount,
  CASE
    WHEN onceki_favori IS NULL THEN NULL
    ELSE (num_favorers - onceki_favori)
         / (date_diff('second', onceki_an, observed_at) / 86400.0)
  END AS favorite_velocity
FROM ardisik;

-- Nis basina son tamamlanmis snapshot.
CREATE OR REPLACE VIEW v_latest_snapshot AS
SELECT niche_id, snapshot_id, started_at
FROM (
  SELECT niche_id, snapshot_id, started_at,
         ROW_NUMBER() OVER (PARTITION BY niche_id ORDER BY started_at DESC) AS sira
  FROM snapshots
  WHERE status = 'complete'
)
WHERE sira = 1;
