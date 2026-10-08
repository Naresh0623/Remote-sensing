const mongoose = require('mongoose');
const UrbanGrowth = require('../models/UrbanGrowth');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const mongoURI = 'mongodb://127.0.0.1:27017/chennai_urban_growth'; // Local MongoDB URI for seeding

const seedData = async () => {
  try {
    await mongoose.connect(mongoURI);
    await UrbanGrowth.deleteMany({});

    const results = [];
    const csvPath = path.join(__dirname, '../data/Chennai_Urban_Growth_Stats.csv');

    fs.createReadStream(csvPath)
      .pipe(csv())
      .on('data', (row) => {
        const baseD18 = parseFloat(row.density_2018) || 0.3;
        const baseD24 = parseFloat(row.density_2024) || 0.45;

        for (let w = 0; w <= 200; w++) {
          const variation = (Math.sin(w) * 0.12);
          
          // 1. Built-up Density (NDBI)
          const d18 = Math.abs(baseD18 + variation);
          const d24 = Math.abs(baseD24 + (variation * 1.2));

          // 2. Population (Unique)
          const p18 = Math.round(45000 + (w * 150) + (variation * 8000));
          const p24 = Math.round(p18 * (1.1 + (variation * 0.05)));

          // 3. NDVI (Vegetation - Inverse of Density)
          const ndvi18 = Math.max(0.1, 0.6 - d18); 
          const ndvi24 = Math.max(0.05, 0.55 - d24);

          // 4. NDWI (Water - Geography based variation)
          const ndwi18 = (Math.cos(w) * 0.1) - 0.05;
          const ndwi24 = ndwi18 - 0.02; // Simulating slight water body reduction

          results.push({ wardNo: w, year: 2018, density: d18, population: p18, ndvi: ndvi18, ndwi: ndwi18 });
          results.push({ wardNo: w, year: 2024, density: d24, population: p24, ndvi: ndvi24, ndwi: ndwi24 });
        }
      })
      .on('end', async () => {
        await UrbanGrowth.insertMany(results);
        console.log(`✅ Success! Seeded 402 records with NDVI & NDWI data.`);
        mongoose.connection.close();
      });
  } catch (err) { console.error(err); }
};
seedData();