// Profiles use centimetres and grams. Stack garments flat in one shipping bag.
const combineShippingPackages = (packages) => {
  if (!Array.isArray(packages) || !packages.length || packages.length > 50) throw new Error("Invalid shipping package count");
  const combined = { number: "1", length: 0, width: 0, height: 0, weight: 0 };
  for (const parcel of packages) {
    if (["length", "width", "height", "weight"].some(key => !Number.isSafeInteger(parcel?.[key]) || parcel[key] <= 0)) throw new Error("Invalid shipping dimensions");
    combined.length = Math.max(combined.length, parcel.length);
    combined.width = Math.max(combined.width, parcel.width);
    combined.height += parcel.height;
    combined.weight += parcel.weight;
  }
  return [combined];
};
module.exports = { combineShippingPackages };
