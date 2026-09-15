import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from '../src/index.js';

describe('core paketi', () => {
  it('sürüm sabitini dışa açar', () => {
    expect(CORE_VERSION).toBe('0.1.0');
  });
});
