const mongoose = require('mongoose');

const UrbanGrowthSchema = new mongoose.Schema({
  wardNo: Number,
  year: Number,
  density: Number,
  ndvi: Number,
  ndwi: Number,
  population: Number,
  isPrediction: Boolean
}, { collection: 'urbangrowths' }); // <--- CHANGE THIS to your actual collection name!

module.exports = mongoose.model('UrbanGrowth', UrbanGrowthSchema);