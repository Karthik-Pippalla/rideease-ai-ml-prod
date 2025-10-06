function haversineMiles(p1, p2) {
    const [lng1, lat1] = p1.coordinates;
    const [lng2, lat2] = p2.coordinates;
    const toRad = (x) => (x * Math.PI) / 180;
    const R = 3958.7613; // miles
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return +(R * c).toFixed(2);
  }
  module.exports = { haversineMiles };