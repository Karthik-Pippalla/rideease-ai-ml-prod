const { validateRawEvent } = require('../validation');

describe('raw event validation', () => {
  test('valid event', () => {
    const evt = { type: 'play', userId: 'u1', ts: new Date().toISOString(), payload: { foo: 'bar' } };
    expect(validateRawEvent(evt).valid).toBe(true);
  });
  test('missing fields', () => {
    const evt = { type: 'play' };
    const res = validateRawEvent(evt);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('userId is required');
  });
});
