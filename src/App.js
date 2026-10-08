import React, { useMemo, useState, useEffect } from 'react';
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import axios from 'axios';
import { Bar } from 'react-chartjs-2'; 
import 'leaflet/dist/leaflet.css';
import './App.css';
import PlanningBot from './planningBot'; 

import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

function App() {
  const [geoData, setGeoData] = useState(null);
  const [growthStats, setGrowthStats] = useState([]);
  const [selectedYear, setSelectedYear] = useState(2018);
  const [viewType, setViewType] = useState('density'); 
  const [botToast, setBotToast] = useState(null);
  const [selectedWard, setSelectedWard] = useState(null);
  const [scenario, setScenario] = useState({
    projectType: 'housing',
    priority: 'balanced',
    budget: 'medium'
  });
  const [scenarioResults, setScenarioResults] = useState([]);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [compareWardA, setCompareWardA] = useState('');
  const [compareWardB, setCompareWardB] = useState('');
  const [policyPresets, setPolicyPresets] = useState([]);
  const [policyPreset, setPolicyPreset] = useState('baseline');
  const [liveSignals, setLiveSignals] = useState(null);
  const [impactResult, setImpactResult] = useState(null);
  const [beneficiaries, setBeneficiaries] = useState(10000);
  const [feedbackSummary, setFeedbackSummary] = useState({ positive: 0, negative: 0 });
  const [wardInsight, setWardInsight] = useState(null);

  useEffect(() => {
    fetch('/Wards.geojson').then(res => res.json()).then(data => setGeoData(data));

    Promise.all([
      axios.get('/api/growth'),
      axios.get('/api/recommend/predict-2026')
    ])
      .then(([baseRes, predictedRes]) => {
        setGrowthStats([...baseRes.data, ...predictedRes.data]);
      })
      .catch(() => {
        axios.get('/api/growth').then(res => setGrowthStats(res.data));
      });

    axios.get('/api/recommend/policy-presets').then((res) => {
      setPolicyPresets(res.data?.presets || []);
    }).catch(() => {});

    axios.get('/api/recommend/feedback-summary').then((res) => {
      setFeedbackSummary(res.data || { positive: 0, negative: 0 });
    }).catch(() => {});

    axios.get('/api/recommend/live-signals').then((res) => {
      setLiveSignals(res.data || null);
    }).catch(() => {});
  }, []);

  const runScenarioRanking = async (nextScenario = scenario) => {
    setScenarioLoading(true);
    try {
      const response = await axios.post('/api/recommend/scenario-rank', {
        ...nextScenario,
        policyPreset,
        limit: 5
      });
      setScenarioResults(response.data?.topWards || []);
    } catch (error) {
      setScenarioResults([]);
      window.dispatchEvent(new CustomEvent('botStatus', {
        detail: {
          type: 'error',
          status: 'Scenario Ranking Error',
          recommendation: 'Unable to generate ranking right now. Please retry.',
          color: '#ff5c5c'
        }
      }));
    } finally {
      setScenarioLoading(false);
    }
  };

  useEffect(() => {
    if (!growthStats.length) return;
    runScenarioRanking(scenario);
  }, [growthStats]);

  useEffect(() => {
    if (selectedWard === null) return;

    axios.post('/api/recommend/analyze-site', { wardName: selectedWard }).then((res) => {
      setWardInsight(res.data || null);
    }).catch(() => {
      setWardInsight(null);
    });

    axios.get(`/api/recommend/live-signals?wardNo=${selectedWard}`).then((res) => {
      setLiveSignals(res.data || null);
    }).catch(() => {});
  }, [selectedWard]);

  useEffect(() => {
    const handleBotStatus = (event) => {
      const detail = event?.detail;
      if (!detail) return;

      // Only show top-right notification toast for ward interactions coming from map actions.
      if (detail.source !== 'map') {
        return;
      }

      setBotToast({
        type: detail.type || 'success',
        status: detail.status || 'Result',
        recommendation: detail.recommendation || 'Analysis complete.',
        color: detail.color || '#00ffff'
      });
    };

    window.addEventListener('botStatus', handleBotStatus);
    return () => window.removeEventListener('botStatus', handleBotStatus);
  }, []);

  useEffect(() => {
    if (!botToast || botToast.type === 'loading') return;

    const timeoutId = setTimeout(() => {
      setBotToast(null);
    }, 7000);

    return () => clearTimeout(timeoutId);
  }, [botToast]);

  const wardLookup = useMemo(() => {
    if (!geoData?.features?.length) return {};

    return geoData.features.reduce((acc, feature) => {
      const wardId = feature?.properties?.Ward_No || feature?.properties?.ward_id;
      const wardName = feature?.properties?.Ward_Name;
      const zoneName = feature?.properties?.Zone_Name;

      if (!wardId) return acc;

      if (wardName) {
        const normalizedWardName = String(wardName).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        acc[normalizedWardName] = String(wardId);
      }
      if (zoneName) {
        const normalizedZoneName = String(zoneName).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        acc[normalizedZoneName] = String(wardId);
      }

      acc[`ward ${wardId}`.toLowerCase()] = String(wardId);
      return acc;
    }, {});
  }, [geoData]);

  const layerInfo = {
    density: { label: 'Urban Built-up', unit: '%', color: '#f44336' },
    ndvi: { label: 'Vegetation Index', unit: '', color: '#4caf50' },
    ndwi: { label: 'Water Index', unit: '', color: '#2196f3' },
    population: { label: 'Total Population', unit: '', color: '#ff9800' }
  };

  const currentStats = growthStats.filter(d => d.year === selectedYear);
  const allWardNumbers = useMemo(() => {
    const wards = [...new Set(growthStats.map((row) => Number(row.wardNo)).filter(Number.isFinite))];
    return wards.sort((a, b) => a - b);
  }, [growthStats]);

  const yearSeries = useMemo(() => [2018, 2024, 2026], []);

  const getMetricForCharts = (row, metric) => {
    if (!row) return 0;
    const value = Number(row[metric]) || 0;
    if (metric === 'density') return value * 100;
    return value;
  };

  const yearlyAverages = useMemo(() => {
    return yearSeries.map((year) => {
      const rows = growthStats.filter((d) => d.year === year);
      if (!rows.length) return 0;

      const total = rows.reduce((sum, row) => sum + getMetricForCharts(row, viewType), 0);
      return total / rows.length;
    });
  }, [growthStats, viewType, yearSeries]);

  const selectedWardTrend = useMemo(() => {
    if (selectedWard === null) return [];

    return yearSeries.map((year) => {
      const row = growthStats.find((d) => Number(d.wardNo) === Number(selectedWard) && d.year === year);
      return row ? getMetricForCharts(row, viewType) : 0;
    });
  }, [growthStats, selectedWard, viewType, yearSeries]);

  const comparisonTrendA = useMemo(() => {
    if (!compareWardA) return [0, 0, 0];
    return yearSeries.map((year) => {
      const row = growthStats.find((d) => Number(d.wardNo) === Number(compareWardA) && d.year === year);
      return row ? getMetricForCharts(row, viewType) : 0;
    });
  }, [compareWardA, growthStats, viewType, yearSeries]);

  const comparisonTrendB = useMemo(() => {
    if (!compareWardB) return [0, 0, 0];
    return yearSeries.map((year) => {
      const row = growthStats.find((d) => Number(d.wardNo) === Number(compareWardB) && d.year === year);
      return row ? getMetricForCharts(row, viewType) : 0;
    });
  }, [compareWardB, growthStats, viewType, yearSeries]);

  const formatMetricValue = (record, metric) => {
    if (!record) return 'N/A';
    if (metric === 'population') {
      return Number.isFinite(record.population) ? record.population.toLocaleString() : 'N/A';
    }
    const rawValue = record[metric];
    if (!Number.isFinite(rawValue)) return 'N/A';
    const scale = metric === 'density' ? 100 : 1;
    return (rawValue * scale).toFixed(2);
  };

  const mapStyle = (feature) => {
    const wardId = feature.properties.Ward_No || feature.properties.ward_id;
    const wardData = growthStats.find(d => Number(d.wardNo) === Number(wardId) && d.year === selectedYear);
    const value = wardData ? wardData[viewType] : 0.05;

    return {
      fillColor: layerInfo[viewType].color,
      weight: 1.5, 
      color: '#ffffff', 
      fillOpacity: viewType === 'population' ? (value / 150000) : (value * 1.3)
    };
  };

  const onEachWard = (feature, layer) => {
    const wardId = feature.properties.Ward_No || feature.properties.ward_id;
    const areaName = feature.properties.Ward_Name || feature.properties.Zone_Name || "Chennai Ward";
    const displayName = `${areaName} (Ward ${wardId})`; 

    const d = growthStats.find(st => Number(st.wardNo) === Number(wardId) && st.year === selectedYear);
    
    layer.on({
      mouseover: (e) => {
        const l = e.target;
        l.setStyle({ weight: 4, color: '#00ffff', fillOpacity: 0.9 }); 
        l.bringToFront();
      },
      mouseout: (e) => {
        const l = e.target;
        l.setStyle(mapStyle(feature));
      },
      // Open the bot and analyze the clicked ward.
      click: (e) => {
        setSelectedWard(wardId);
        if (!compareWardA) {
          setCompareWardA(String(wardId));
        } else if (!compareWardB && String(compareWardA) !== String(wardId)) {
          setCompareWardB(String(wardId));
        }
        window.dispatchEvent(new CustomEvent('botSearch', { detail: String(wardId) }));
        e.target.openPopup();
      }
    });

    layer.bindPopup(`
      <div class="custom-popup">
        <h3>${displayName}</h3>
        <p>Ward ID: <b>${wardId}</b></p>
        <p>${layerInfo[viewType].label}: <b>${formatMetricValue(d, viewType)}${layerInfo[viewType].unit}</b></p>
        <button onclick="window.dispatchEvent(new CustomEvent('botSearch', {detail: '${wardId}'}))" style="margin-top:5px; cursor:pointer;">Analyze Site</button>
      </div>
    `);
  };

  const runImpactSimulation = async () => {
    if (selectedWard === null) {
      window.dispatchEvent(new CustomEvent('botStatus', {
        detail: {
          type: 'warning',
          status: 'Select a Ward',
          recommendation: 'Select a ward from map or scenario list before simulation.',
          color: '#ffb300'
        }
      }));
      return;
    }

    try {
      const res = await axios.post('/api/recommend/impact-simulate', {
        wardNo: selectedWard,
        projectType: scenario.projectType,
        budget: scenario.budget,
        beneficiaries,
        policyPreset
      });
      setImpactResult(res.data || null);
    } catch (error) {
      setImpactResult(null);
    }
  };

  const submitFeedback = async (verdict) => {
    if (selectedWard === null) return;

    try {
      await axios.post('/api/recommend/feedback', {
        wardNo: selectedWard,
        verdict,
        scenario: {
          ...scenario,
          policyPreset
        }
      });

      const summaryRes = await axios.get('/api/recommend/feedback-summary');
      setFeedbackSummary(summaryRes.data || { positive: 0, negative: 0 });
    } catch (error) {
      // no-op
    }
  };

  const generateReport = async () => {
    if (selectedWard === null) {
      return;
    }

    try {
      const response = await axios.post('/api/recommend/report', {
        wardNo: selectedWard,
        projectType: scenario.projectType,
        priority: scenario.priority,
        budget: scenario.budget,
        policyPreset
      });

      const reportData = response.data;
      const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `ward-${selectedWard}-planning-report.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);

      const popup = window.open('', '_blank');
      if (popup) {
        popup.document.write(`<html><head><title>Ward ${selectedWard} Report</title></head><body><pre>${JSON.stringify(reportData, null, 2)}</pre></body></html>`);
        popup.document.close();
      }
    } catch (error) {
      // no-op
    }
  };

  return (
    <div className="command-center neon-grid">
      <header className="top-nav">
        <div className="logo">CHENNAI <span>URBAN FUTURES LAB</span></div>
        <div className="year-tabs">
          <button className={selectedYear === 2018 ? "active" : ""} onClick={() => setSelectedYear(2018)}>2018</button>
          <button className={selectedYear === 2024 ? "active" : ""} onClick={() => setSelectedYear(2024)}>2024</button>
          <button className={selectedYear === 2026 ? "active" : ""} onClick={() => setSelectedYear(2026)}>2026 (Pred)</button>
        </div>
      </header>

      <div className="dashboard-body">
        <aside className="control-sidebar">
          <div className="nav-group">
            <label>Analysis Layer</label>
            <div className="index-grid">
              {Object.keys(layerInfo).map(key => (
                <button key={key} className={viewType === key ? "active" : ""} onClick={() => setViewType(key)}>
                  {layerInfo[key].label}
                </button>
              ))}
            </div>
          </div>

          <div className="nav-group glass-card">
            <label>Scenario Studio</label>
            <div className="scenario-grid">
              <select value={scenario.projectType} onChange={(e) => setScenario((prev) => ({ ...prev, projectType: e.target.value }))}>
                <option value="housing">Housing</option>
                <option value="hospital">Hospital</option>
                <option value="school">School</option>
                <option value="drainage">Drainage</option>
                <option value="park">Park</option>
                <option value="public_toilet">Public Toilet</option>
              </select>
              <select value={scenario.priority} onChange={(e) => setScenario((prev) => ({ ...prev, priority: e.target.value }))}>
                <option value="balanced">Balanced Priority</option>
                <option value="population_impact">Population Impact</option>
                <option value="environmental_safety">Environmental Safety</option>
                <option value="cost_sensitive">Cost Sensitive</option>
              </select>
              <select value={scenario.budget} onChange={(e) => setScenario((prev) => ({ ...prev, budget: e.target.value }))}>
                <option value="low">Low Budget</option>
                <option value="medium">Medium Budget</option>
                <option value="high">High Budget</option>
              </select>
              <select value={policyPreset} onChange={(e) => setPolicyPreset(e.target.value)}>
                {policyPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.title}</option>
                ))}
              </select>
              <button className="rank-btn" onClick={() => runScenarioRanking()} disabled={scenarioLoading}>
                {scenarioLoading ? 'Ranking...' : 'Rank Top Wards'}
              </button>
            </div>

            <div className="scenario-list">
              {scenarioResults.map((ward) => (
                <button
                  key={ward.wardNo}
                  className="scenario-item"
                  onClick={() => {
                    setSelectedWard(ward.wardNo);
                    window.dispatchEvent(new CustomEvent('botSearch', { detail: String(ward.wardNo) }));
                  }}
                >
                  <div className="scenario-head">
                    <span>Ward {ward.wardNo}</span>
                    <span>{ward.suitabilityScore}/100</span>
                  </div>
                  <p>{ward.status} | Confidence {ward.confidence}%</p>
                  <p>{(ward.riskTags || []).length ? ward.riskTags.join(', ') : 'No major risk tags'}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="nav-group chart-box">
            <label>Spectral Trends (Top 10)</label>
            <div style={{ height: '160px' }}>
              <Bar 
                data={{
                  labels: currentStats.slice(0, 10).map(w => `W${w.wardNo}`),
                  datasets: [{ label: layerInfo[viewType].label, data: currentStats.slice(0, 10).map(w => getMetricForCharts(w, viewType)), backgroundColor: layerInfo[viewType].color }]
                }} 
                options={{ maintainAspectRatio: false, plugins: { legend: { display: false } } }} 
              />
            </div>
          </div>

          <div className="nav-group chart-box">
            <label>Year-over-Year Change ({layerInfo[viewType].label})</label>
            <div style={{ height: '160px' }}>
              <Bar
                data={{
                  labels: yearSeries,
                  datasets: [{
                    label: `City Avg ${layerInfo[viewType].label}`,
                    data: yearlyAverages,
                    backgroundColor: ['#4f46e5', '#0891b2', '#ea580c']
                  }]
                }}
                options={{ maintainAspectRatio: false, plugins: { legend: { display: false } } }}
              />
            </div>
          </div>

          <div className="nav-group chart-box">
            <label>{selectedWard ? `Ward ${selectedWard} Trend` : 'Ward Trend (Click a Ward)'}</label>
            <div style={{ height: '160px' }}>
              <Bar
                data={{
                  labels: yearSeries,
                  datasets: [{
                    label: selectedWard ? `Ward ${selectedWard}` : 'No Ward Selected',
                    data: selectedWard ? selectedWardTrend : [0, 0, 0],
                    backgroundColor: ['#22c55e', '#eab308', '#ef4444']
                  }]
                }}
                options={{ maintainAspectRatio: false, plugins: { legend: { display: false } } }}
              />
            </div>
          </div>

          <div className="nav-group chart-box">
            <label>Ward Comparison Studio</label>
            <div className="compare-selectors">
              <select value={compareWardA} onChange={(e) => setCompareWardA(e.target.value)}>
                <option value="">Ward A</option>
                {allWardNumbers.map((wardNo) => (
                  <option key={`a-${wardNo}`} value={wardNo}>Ward {wardNo}</option>
                ))}
              </select>
              <select value={compareWardB} onChange={(e) => setCompareWardB(e.target.value)}>
                <option value="">Ward B</option>
                {allWardNumbers.map((wardNo) => (
                  <option key={`b-${wardNo}`} value={wardNo}>Ward {wardNo}</option>
                ))}
              </select>
            </div>
            <div style={{ height: '160px' }}>
              <Bar
                data={{
                  labels: yearSeries,
                  datasets: [
                    {
                      label: compareWardA ? `Ward ${compareWardA}` : 'Ward A',
                      data: comparisonTrendA,
                      backgroundColor: '#22c55e'
                    },
                    {
                      label: compareWardB ? `Ward ${compareWardB}` : 'Ward B',
                      data: comparisonTrendB,
                      backgroundColor: '#f97316'
                    }
                  ]
                }}
                options={{ maintainAspectRatio: false, plugins: { legend: { display: true, labels: { color: '#e5eef9' } } } }}
              />
            </div>
          </div>

          <div className="nav-group chart-box">
            <label>Real-Time Signal Layer</label>
            <div className="signal-grid">
              <div><span>City Density</span><b>{liveSignals?.citySignals?.averageDensityPct ?? 'N/A'}%</b></div>
              <div><span>City Congestion</span><b>{liveSignals?.citySignals?.averageCongestionIndex ?? 'N/A'}</b></div>
              <div><span>City AQI</span><b>{liveSignals?.citySignals?.averageAirQualityIndex ?? 'N/A'}</b></div>
              <div><span>Focused Alerts</span><b>{(liveSignals?.wardSignals?.alerts || []).join(', ') || 'None'}</b></div>
            </div>
          </div>

          <div className="nav-group chart-box">
            <label>Project Impact Simulator</label>
            <div className="simulator-grid">
              <input
                type="number"
                min="100"
                step="100"
                value={beneficiaries}
                onChange={(e) => setBeneficiaries(Number(e.target.value) || 0)}
                placeholder="Beneficiaries"
              />
              <button className="rank-btn" onClick={runImpactSimulation}>Simulate Impact</button>
            </div>
            {impactResult && (
              <div className="impact-metrics">
                <p>Serviced Population: {impactResult.servicedPopulation}</p>
                <p>Congestion Shift: {impactResult.congestionShiftPct}%</p>
                <p>Infra Load Index: {impactResult.infraLoadIndex}</p>
                <p>Green Pressure Delta: {impactResult.greenPressureDelta}</p>
              </div>
            )}
          </div>

          <div className="nav-group chart-box">
            <label>Report + Feedback Loop</label>
            <div className="feedback-row">
              <button className="rank-btn" onClick={generateReport}>Export Report</button>
              <button className="feedback-btn" onClick={() => submitFeedback('positive')}>Useful</button>
              <button className="feedback-btn danger" onClick={() => submitFeedback('negative')}>Not Useful</button>
            </div>
            <p className="feedback-summary">Feedback Totals: +{feedbackSummary.positive} / -{feedbackSummary.negative}</p>
          </div>

          <div className="nav-group directory-section">
            <label>Full Ward Directory (200+)</label>
            <div className="directory-scroll">
              <table>
                <thead><tr><th>Ward</th><th>{layerInfo[viewType].label}</th></tr></thead>
                <tbody>
                  {currentStats.map((w, i) => (
                    <tr key={i}>
                      <td>Ward {w.wardNo}</td>
                      <td>{formatMetricValue(w, viewType)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </aside>

        <main className="map-portal">
          {selectedWard && (
            <div className="ward-pulse-card">
              <p>Focused Ward</p>
              <h3>Ward {selectedWard}</h3>
              <span>
                {wardInsight
                  ? `Score ${wardInsight.suitabilityScore || 'N/A'}/100 | Confidence ${wardInsight.confidence || 'N/A'}% | Risks: ${(wardInsight.riskTags || []).join(', ') || 'None'}`
                  : 'Click Analyze in chat to generate explainable recommendation and risk profile.'}
              </span>
            </div>
          )}

          {botToast && (
            <div className={`bot-toast ${botToast.type}`} role="status" aria-live="polite" style={{ '--toast-color': botToast.color }}>
              <p className="bot-toast-title">{botToast.status}</p>
              <p className="bot-toast-text">{botToast.recommendation}</p>
            </div>
          )}
          <MapContainer key={`${selectedYear}-${viewType}`} center={[13.0827, 80.2707]} zoom={11} className="leaflet-main">
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {geoData && <GeoJSON data={geoData} style={mapStyle} onEachFeature={onEachWard} />}
          </MapContainer>
        </main>
      </div>

      {/* 4. Place the floating bot here */}
      <PlanningBot wardLookup={wardLookup} />
    </div>
  );
}

export default App;