const onEachWard = (feature, layer) => {
  // Extract ward name from your Wards.geojson properties
  const wardName = feature.properties.NAME || feature.properties.WARD_NAME;
  
  // Find matching data from MongoDB API results
  const stats = growthData.find(d => d.wardName === wardName && d.year === selectedYear);
  const density = stats ? stats.density : 0;

  layer.bindPopup(`
    <strong>Ward: ${wardName}</strong><br/>
    Building Density: ${(density * 100).toFixed(2)}%<br/>
    Status: ${selectedYear > 2025 ? 'Predicted Growth' : 'Observed Data'}
  `);

  layer.on({
    mouseover: (e) => e.target.setStyle({ weight: 4, color: '#fdd835' }),
    mouseout: (e) => e.target.setStyle({ weight: 1, color: 'white' })
  });
};