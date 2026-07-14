// Run once: node scripts/seed-mini-stock-skus.js
// Marks 50 SKUs as inMiniStock: true in the products collection.
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Product = require('../models/products');

const MINI_STOCK_SKUS = [
  'DM100418', 'DM100421', 'DM102534', 'DM102744', 'DM103270',
  'DM103607', 'DM104492', 'DM105221', 'DM106474', 'DM106490',
  'DM106493', 'DM108085', 'DM108200', 'DM108240', 'DM108241',
  'DM108731', 'DM111883', 'DOT-115707', 'DM115865', 'DM115880',
  'DM115906', 'DM115926', 'DM115947', 'DM116297', 'DM118588',
  'DM118939', 'DM129396', 'DM140710', 'DM2-120564-1', 'DM2-127032',
  'DM2-127349', 'DM2-127516', 'DM2-127685', 'DM2-127687', 'DM2-127854',
  'DM2-128004', 'DM2-128454', 'DM2-129963', 'DM2-129979', 'DM2-130720',
  'DM2-130790', 'DM2-130861', 'DM2-131082', 'DM2-131228', 'DM2-132530',
  'DM2-132589', 'DM2-136900', 'DOV-140232', 'DOT-127349', 'DOT-102744'
];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const result = await Product.updateMany(
    { sku: { $in: MINI_STOCK_SKUS } },
    { $set: { inMiniStock: true } }
  );

  console.log(`Updated ${result.modifiedCount} products (matched ${result.matchedCount})`);

  const notFound = [];
  for (const sku of MINI_STOCK_SKUS) {
    const exists = await Product.exists({ sku });
    if (!exists) notFound.push(sku);
  }
  if (notFound.length) {
    console.warn('SKUs not found in products collection:', notFound);
  }

  await mongoose.disconnect();
  console.log('Done');
})();
