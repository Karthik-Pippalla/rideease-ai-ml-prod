const { haversineMiles } = require('../utils/distance');

describe('haversineMiles', () => {
  it('returns ~0 for identical points', () => {
    const p = { coordinates: [0,0] };
    expect(haversineMiles(p, p)).toBeCloseTo(0, 2);
  });

  it('computes SF to LA distance roughly', () => {
    const sf = { coordinates: [-122.4194, 37.7749] };
    const la = { coordinates: [-118.2437, 34.0522] };
    const d = haversineMiles(sf, la);
    expect(d).toBeGreaterThan(340);
    expect(d).toBeLessThan(400);
  });
});
