const Ward = require('../models/UrbanGrowth');
const FeedbackLog = require('../models/FeedbackLog');

const POLICY_PRESETS = {
    baseline: {
        id: 'baseline',
        title: 'Baseline Compliance',
        description: 'Balanced planning with neutral policy weighting.'
    },
    flood_safe: {
        id: 'flood_safe',
        title: 'Flood Safe First',
        description: 'Strictly deprioritize wards with higher water stress and flood risk.'
    },
    green_shield: {
        id: 'green_shield',
        title: 'Green Shield',
        description: 'Prioritize wards with better vegetation and heat resilience.'
    },
    equity_access: {
        id: 'equity_access',
        title: 'Equity Access',
        description: 'Prioritize higher-population wards needing essential services.'
    }
};

const parseWardNumber = (value) => {
    const cleaned = String(value || '').trim();
    if (!cleaned) return null;
    const match = cleaned.match(/\d+/);
    if (!match) return null;

    const wardNo = parseInt(match[0], 10);
    return Number.isNaN(wardNo) ? null : wardNo;
};

const projectMetric = (value2018, value2024, min, max, round = false) => {
    const v18 = Number(value2018) || 0;
    const v24 = Number(value2024) || 0;
    const annualStep = (v24 - v18) / 6;
    const projected = v24 + (annualStep * 2);
    const clamped = Math.max(min, Math.min(max, projected));

    if (round) {
        return Math.round(clamped);
    }
    return Number(clamped.toFixed(6));
};

const buildProjected2026Record = (record2018, record2024) => ({
    wardNo: record2024.wardNo,
    year: 2026,
    density: projectMetric(record2018?.density, record2024.density, 0, 1),
    ndvi: projectMetric(record2018?.ndvi, record2024.ndvi, 0, 1),
    ndwi: projectMetric(record2018?.ndwi, record2024.ndwi, -1, 1),
    population: projectMetric(record2018?.population, record2024.population, 0, 5000000, true),
    isPrediction: true
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeText = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const getSignalBundle = (wardNo, row2024) => {
    const baseRain = 30 + ((Math.sin(wardNo) + 1) * 25);
    const rainfallMm = Number(baseRain.toFixed(1));

    const congestionIndex = clamp(Number((((row2024?.density || 0) * 100) + ((wardNo % 13) * 1.7)).toFixed(1)), 5, 99);
    const airQualityIndex = clamp(Number((55 + ((1 - (row2024?.ndvi || 0)) * 75) + ((wardNo % 8) * 2)).toFixed(1)), 25, 220);
    const complaintIndex = clamp(Number((20 + ((row2024?.population || 0) / 6000) + ((wardNo % 9) * 1.8)).toFixed(1)), 5, 100);

    const alerts = [];
    if ((row2024?.ndwi || 0) > 0.08 || rainfallMm > 58) alerts.push('Water Logging Watch');
    if ((row2024?.ndvi || 0) < 0.16 || airQualityIndex > 120) alerts.push('Urban Heat Alert');
    if ((row2024?.density || 0) > 0.45 || congestionIndex > 75) alerts.push('Traffic Congestion Alert');

    return {
        rainfallMm,
        congestionIndex,
        airQualityIndex,
        complaintIndex,
        alerts
    };
};

const getScenarioWeights = (projectType = 'housing', priority = 'balanced') => {
    const baseByProject = {
        housing: { density: 0.35, ndvi: 0.2, ndwi: 0.2, population: 0.25 },
        hospital: { density: 0.25, ndvi: 0.15, ndwi: 0.25, population: 0.35 },
        school: { density: 0.25, ndvi: 0.25, ndwi: 0.2, population: 0.3 },
        drainage: { density: 0.15, ndvi: 0.15, ndwi: 0.5, population: 0.2 },
        park: { density: 0.2, ndvi: 0.45, ndwi: 0.2, population: 0.15 },
        public_toilet: { density: 0.2, ndvi: 0.1, ndwi: 0.15, population: 0.55 }
    };

    const priorityModifiers = {
        balanced: { density: 0, ndvi: 0, ndwi: 0, population: 0 },
        population_impact: { density: -0.03, ndvi: -0.02, ndwi: -0.02, population: 0.07 },
        environmental_safety: { density: -0.04, ndvi: 0.05, ndwi: 0.04, population: -0.05 },
        cost_sensitive: { density: 0.06, ndvi: -0.02, ndwi: -0.02, population: -0.02 }
    };

    const base = baseByProject[projectType] || baseByProject.housing;
    const modifier = priorityModifiers[priority] || priorityModifiers.balanced;
    const merged = {
        density: clamp(base.density + modifier.density, 0.05, 0.7),
        ndvi: clamp(base.ndvi + modifier.ndvi, 0.05, 0.7),
        ndwi: clamp(base.ndwi + modifier.ndwi, 0.05, 0.7),
        population: clamp(base.population + modifier.population, 0.05, 0.7)
    };

    const total = merged.density + merged.ndvi + merged.ndwi + merged.population;
    return {
        density: merged.density / total,
        ndvi: merged.ndvi / total,
        ndwi: merged.ndwi / total,
        population: merged.population / total
    };
};

const computeWardInsight = ({ row2024, row2026, projectType, priority, budget, policyPreset = 'baseline' }) => {
    const safeBudget = String(budget || 'medium').toLowerCase();
    const weights = getScenarioWeights(projectType, priority);

    const densityScore = clamp((1 - (row2024.density || 0)) * 100, 0, 100);
    const ndviScore = clamp((row2024.ndvi || 0) * 100, 0, 100);
    const waterSafetyScore = clamp((1 - Math.abs(row2024.ndwi || 0)) * 100, 0, 100);
    const populationNeedScore = clamp(((row2024.population || 0) / 90000) * 100, 0, 100);

    let suitabilityScore =
        (densityScore * weights.density) +
        (ndviScore * weights.ndvi) +
        (waterSafetyScore * weights.ndwi) +
        (populationNeedScore * weights.population);

    if (safeBudget === 'low') {
        suitabilityScore -= clamp((row2024.density || 0) * 20, 0, 20);
    } else if (safeBudget === 'high') {
        suitabilityScore += 4;
    }

    suitabilityScore = clamp(Number(suitabilityScore.toFixed(2)), 0, 100);

    const densityTrend = ((row2026.density - row2024.density) * 100);
    const populationTrend = (((row2026.population - row2024.population) / Math.max(row2024.population, 1)) * 100);

    const riskTags = [];
    if ((row2024.ndwi || 0) > 0.08) riskTags.push('Flood Risk');
    if ((row2024.ndvi || 0) < 0.16) riskTags.push('Heat Island Risk');
    if ((row2024.density || 0) > 0.45) riskTags.push('Congestion Risk');
    if (populationTrend > 10) riskTags.push('Service Pressure Risk');

    if (policyPreset === 'flood_safe') {
        const floodPenalty = clamp(Math.max(0, (row2024.ndwi || 0) * 90), 0, 14);
        suitabilityScore = clamp(Number((suitabilityScore - floodPenalty).toFixed(2)), 0, 100);
        if (!riskTags.includes('Policy: Flood Sensitive Zone')) {
            riskTags.push('Policy: Flood Sensitive Zone');
        }
    }

    if (policyPreset === 'green_shield') {
        const greenBoost = clamp((row2024.ndvi || 0) * 12, 0, 8);
        suitabilityScore = clamp(Number((suitabilityScore + greenBoost).toFixed(2)), 0, 100);
    }

    if (policyPreset === 'equity_access') {
        const equityBoost = clamp(((row2024.population || 0) / 120000) * 10, 0, 10);
        suitabilityScore = clamp(Number((suitabilityScore + equityBoost).toFixed(2)), 0, 100);
    }

    const uncertainty = clamp((Math.abs(densityTrend) * 0.7) + (riskTags.length * 4), 0, 30);
    const confidence = clamp(Number((92 - uncertainty).toFixed(2)), 55, 96);

    return {
        wardNo: row2024.wardNo,
        suitabilityScore,
        confidence,
        riskTags,
        metrics: {
            density2024: Number(((row2024.density || 0) * 100).toFixed(2)),
            density2026: Number(((row2026.density || 0) * 100).toFixed(2)),
            ndvi2024: Number((row2024.ndvi || 0).toFixed(3)),
            ndwi2024: Number((row2024.ndwi || 0).toFixed(3)),
            population2024: row2024.population || 0,
            population2026: row2026.population || 0
        },
        explanation: [
            `Built-up suitability score: ${densityScore.toFixed(1)}/100`,
            `Vegetation support score: ${ndviScore.toFixed(1)}/100`,
            `Water safety score: ${waterSafetyScore.toFixed(1)}/100`,
            `Population impact score: ${populationNeedScore.toFixed(1)}/100`
        ],
        trend: {
            densityDeltaPctPoint: Number(densityTrend.toFixed(2)),
            populationDeltaPct: Number(populationTrend.toFixed(2))
        }
    };
};

const getStatusFromScore = (score) => {
    if (score >= 75) return { status: 'Highly Suitable', color: '#00d68f' };
    if (score >= 60) return { status: 'Conditionally Feasible', color: '#ffb020' };
    return { status: 'Low Suitability', color: '#ff5c5c' };
};

const getWardRecordsWithProjection = async (wardNo) => {
    const [row2018, row2024] = await Promise.all([
        Ward.findOne({ wardNo, year: 2018 }).lean(),
        Ward.findOne({ wardNo, year: 2024 }).lean()
    ]);

    if (!row2024) {
        return null;
    }

    const row2026 = buildProjected2026Record(row2018, row2024);
    return { row2018, row2024, row2026 };
};

const getWardRecommendationPayload = async (wardNo, scenarioOverrides = {}) => {
    const data = await getWardRecordsWithProjection(wardNo);

    if (!data) {
        return {
            ok: false,
            code: 404,
            payload: {
                recommendation: `Ward ${wardNo} not found. Ensure 2024 data is seeded.`,
                status: 'Not Found',
                color: '#ff5252'
            }
        };
    }

    const { row2024: data2024, row2026: data2026 } = data;

    const insight = computeWardInsight({
        row2024: data2024,
        row2026: data2026,
        projectType: scenarioOverrides.projectType || 'housing',
        priority: scenarioOverrides.priority || 'balanced',
        budget: scenarioOverrides.budget || 'medium',
        policyPreset: scenarioOverrides.policyPreset || 'baseline'
    });
    const { status, color } = getStatusFromScore(insight.suitabilityScore);

    let recommendation = `Ward ${wardNo} scored ${insight.suitabilityScore}/100 with confidence ${insight.confidence}%. `;
    recommendation += `${status} for the selected development context.`;
    if (insight.riskTags.length) {
        recommendation += ` Risk flags: ${insight.riskTags.join(', ')}.`;
    }

    if (insight.suitabilityScore < 60) {
        const alternative = await Ward.findOne({ year: 2024, density: { $lte: 0.35 } })
            .sort({ density: 1 })
            .lean();

        if (alternative) {
            recommendation += ` Consider Ward ${alternative.wardNo} as an alternative (density ${(alternative.density * 100).toFixed(2)}%).`;
        }
    }

    return {
        ok: true,
        code: 200,
        payload: {
            status,
            recommendation,
            color,
            suitabilityScore: insight.suitabilityScore,
            confidence: insight.confidence,
            riskTags: insight.riskTags,
            explanation: insight.explanation,
            trend: insight.trend,
            metrics: insight.metrics,
            policyPreset: scenarioOverrides.policyPreset || 'baseline'
        }
    };
};

const getRecommendation = async (req, res) => {
    const { wardName } = req.body;
    console.log("Searching for Ward No:", wardName); // Check your terminal for this!

    try {
        const cleanNumber = parseWardNumber(wardName);
        
        if (cleanNumber === null) {
            return res.status(400).json({
                status: "Invalid Input",
                recommendation: "Please enter a valid ward number or ward name.",
                color: "#ffb300"
            });
        }

        const result = await getWardRecommendationPayload(cleanNumber);
        return res.status(result.code).json(result.payload);

    } catch (err) {
        console.error("Controller Error:", err);
        res.status(500).json({
            status: "Server Error",
            recommendation: "Database Error",
            color: "#ff5252"
        });
    }
};

const getChatRecommendation = async (req, res) => {
    const { message } = req.body;

    try {
        const text = String(message || '').trim();
        const normalizedText = normalizeText(text);
        if (!text) {
            return res.status(400).json({
                status: 'Invalid Input',
                answer: 'Please ask a planning question or mention a ward number.'
            });
        }

        const compareMatch = normalizedText.match(/compare\s+ward\s*(\d+)\s+(and|with)\s+ward\s*(\d+)/);
        if (compareMatch) {
            const wardA = parseInt(compareMatch[1], 10);
            const wardB = parseInt(compareMatch[3], 10);

            const [recordA, recordB] = await Promise.all([
                getWardRecommendationPayload(wardA),
                getWardRecommendationPayload(wardB)
            ]);

            if (!recordA.ok || !recordB.ok) {
                return res.status(404).json({
                    status: 'Comparison Error',
                    color: '#ff5252',
                    answer: 'One or both wards were not found for comparison.'
                });
            }

            const winner = recordA.payload.suitabilityScore >= recordB.payload.suitabilityScore
                ? { wardNo: wardA, score: recordA.payload.suitabilityScore }
                : { wardNo: wardB, score: recordB.payload.suitabilityScore };

            return res.json({
                status: 'Comparison Ready',
                color: '#00e5ff',
                answer: `Ward ${wardA} scored ${recordA.payload.suitabilityScore}/100 and Ward ${wardB} scored ${recordB.payload.suitabilityScore}/100. Better option: Ward ${winner.wardNo}. Risk tags: Ward ${wardA} -> ${(recordA.payload.riskTags || []).join(', ') || 'none'}, Ward ${wardB} -> ${(recordB.payload.riskTags || []).join(', ') || 'none'}.`
            });
        }

        if (normalizedText.includes('low cost') || normalizedText.includes('low-cost')) {
            const lowCostRanking = await getScenarioRankingData({
                projectType: 'housing',
                priority: 'cost_sensitive',
                budget: 'low',
                limit: 3,
                policyPreset: 'baseline'
            });

            return res.json({
                status: 'Low Cost Suggestions',
                color: '#00d68f',
                answer: `Top low-cost ward options: ${lowCostRanking.topWards.map((w) => `Ward ${w.wardNo} (${w.suitabilityScore}/100)`).join(', ')}.`
            });
        }

        const nearMatch = normalizedText.match(/alternatives\s+near\s+ward\s*(\d+)/);
        if (nearMatch) {
            const originWard = parseInt(nearMatch[1], 10);
            const nearby = await Ward.find({
                year: 2024,
                wardNo: { $gte: originWard - 10, $lte: originWard + 10 },
                density: { $lte: 0.4 }
            })
                .sort({ density: 1 })
                .limit(4)
                .lean();

            return res.json({
                status: 'Nearby Alternatives',
                color: '#00d68f',
                answer: nearby.length
                    ? `Alternatives near Ward ${originWard}: ${nearby.map((w) => `Ward ${w.wardNo} (${(w.density * 100).toFixed(1)}% built-up)`).join(', ')}.`
                    : `No nearby alternatives found around Ward ${originWard}.`
            });
        }

        const wardNo = parseWardNumber(text);
        if (wardNo !== null) {
            const baseRecommendation = await getWardRecommendationPayload(wardNo);
            if (!baseRecommendation.ok) {
                return res.status(baseRecommendation.code).json({
                    status: baseRecommendation.payload.status,
                    answer: baseRecommendation.payload.recommendation,
                    color: baseRecommendation.payload.color
                });
            }

            const [data2018, data2024] = await Promise.all([
                Ward.findOne({ wardNo, year: 2018 }).lean(),
                Ward.findOne({ wardNo, year: 2024 }).lean()
            ]);

            const predicted2026 = buildProjected2026Record(data2018, data2024);
            const densityDelta = ((predicted2026.density - data2024.density) * 100).toFixed(2);
            const trendWord = Number(densityDelta) >= 0 ? 'increase' : 'decrease';

            const metaParts = [];
            if (Number.isFinite(baseRecommendation.payload.suitabilityScore)) {
                metaParts.push(`Suitability score: ${baseRecommendation.payload.suitabilityScore}/100`);
            }
            if (Number.isFinite(baseRecommendation.payload.confidence)) {
                metaParts.push(`Confidence: ${baseRecommendation.payload.confidence}%`);
            }
            if ((baseRecommendation.payload.riskTags || []).length) {
                metaParts.push(`Risks: ${baseRecommendation.payload.riskTags.join(', ')}`);
            }

            return res.json({
                status: baseRecommendation.payload.status,
                color: baseRecommendation.payload.color,
                answer: `${baseRecommendation.payload.recommendation} From 2024 to 2026, projected built-up density shows a ${trendWord} of ${Math.abs(Number(densityDelta)).toFixed(2)} percentage points. ${metaParts.join(' | ')}`
            });
        }

        const feasibleWards = await Ward.find({ year: 2024, density: { $lte: 0.35 } })
            .sort({ density: 1 })
            .limit(3)
            .lean();

        const alternatives = feasibleWards.length
            ? feasibleWards.map((w) => `Ward ${w.wardNo} (${(w.density * 100).toFixed(1)}%)`).join(', ')
            : 'No low-density wards available in current dataset';

        return res.json({
            status: 'Planning Assistant',
            color: '#00e5ff',
            answer: `I can evaluate feasibility by ward and suggest alternatives. Try commands like: compare ward 28 and ward 51, low-cost housing options, alternatives near ward 40. Current low-density options: ${alternatives}.`
        });
    } catch (err) {
        console.error('Chat Controller Error:', err);
        return res.status(500).json({
            status: 'Server Error',
            answer: 'Unable to process your planning request right now.',
            color: '#ff5252'
        });
    }
};

const getScenarioRankingData = async ({
    projectType = 'housing',
    priority = 'balanced',
    budget = 'medium',
    limit = 5,
    policyPreset = 'baseline'
}) => {
    const [records2018, records2024] = await Promise.all([
        Ward.find({ year: 2018 }).lean(),
        Ward.find({ year: 2024 }).lean()
    ]);

    const byWard2018 = records2018.reduce((acc, row) => {
        acc[row.wardNo] = row;
        return acc;
    }, {});

    const ranked = records2024
        .map((row2024) => {
            const row2026 = buildProjected2026Record(byWard2018[row2024.wardNo], row2024);
            const insight = computeWardInsight({ row2024, row2026, projectType, priority, budget, policyPreset });
            const statusPack = getStatusFromScore(insight.suitabilityScore);
            return {
                ...insight,
                status: statusPack.status,
                color: statusPack.color
            };
        })
        .sort((a, b) => b.suitabilityScore - a.suitabilityScore)
        .slice(0, clamp(Number(limit) || 5, 3, 15));

    return {
        scenario: { projectType, priority, budget, policyPreset },
        topWards: ranked
    };
};

const getScenarioRanking = async (req, res) => {
    const {
        projectType = 'housing',
        priority = 'balanced',
        budget = 'medium',
        limit = 5,
        policyPreset = 'baseline'
    } = req.body || {};

    try {
        const result = await getScenarioRankingData({ projectType, priority, budget, limit, policyPreset });
        return res.json(result);
    } catch (err) {
        console.error('Scenario Ranking Error:', err);
        return res.status(500).json({ message: 'Error generating scenario ranking' });
    }
};

const getPolicyPresets = (req, res) => {
    return res.json({
        presets: Object.values(POLICY_PRESETS)
    });
};

const getLiveSignals = async (req, res) => {
    try {
        const maybeWard = parseWardNumber(req.query.wardNo);
        const all2024 = await Ward.find({ year: 2024 }).lean();

        if (!all2024.length) {
            return res.status(404).json({ message: 'No 2024 records available for live signals.' });
        }

        const averageDensity = all2024.reduce((sum, row) => sum + (row.density || 0), 0) / all2024.length;
        const citySignals = {
            averageDensityPct: Number((averageDensity * 100).toFixed(2)),
            averageCongestionIndex: Number((all2024.reduce((sum, row) => sum + getSignalBundle(row.wardNo, row).congestionIndex, 0) / all2024.length).toFixed(2)),
            averageAirQualityIndex: Number((all2024.reduce((sum, row) => sum + getSignalBundle(row.wardNo, row).airQualityIndex, 0) / all2024.length).toFixed(2)),
            lastUpdated: new Date().toISOString()
        };

        if (maybeWard !== null) {
            const wardRecord = all2024.find((row) => Number(row.wardNo) === maybeWard);
            if (!wardRecord) {
                return res.status(404).json({ message: `Ward ${maybeWard} not found.` });
            }

            return res.json({
                citySignals,
                wardSignals: {
                    wardNo: maybeWard,
                    ...getSignalBundle(maybeWard, wardRecord)
                }
            });
        }

        const topAlerts = all2024
            .map((row) => ({ wardNo: row.wardNo, ...getSignalBundle(row.wardNo, row) }))
            .filter((item) => item.alerts.length)
            .slice(0, 8);

        return res.json({ citySignals, topAlerts });
    } catch (err) {
        console.error('Live Signal Error:', err);
        return res.status(500).json({ message: 'Unable to fetch live signal layer.' });
    }
};

const simulateImpact = async (req, res) => {
    try {
        const {
            wardNo,
            projectType = 'housing',
            beneficiaries = 10000,
            budget = 'medium',
            policyPreset = 'baseline'
        } = req.body || {};

        const parsedWard = parseWardNumber(wardNo);
        if (parsedWard === null) {
            return res.status(400).json({ message: 'Valid wardNo is required.' });
        }

        const records = await getWardRecordsWithProjection(parsedWard);
        if (!records) {
            return res.status(404).json({ message: `Ward ${parsedWard} not found.` });
        }

        const insight = computeWardInsight({
            row2024: records.row2024,
            row2026: records.row2026,
            projectType,
            priority: 'balanced',
            budget,
            policyPreset
        });

        const servicedPopulation = Math.round(Math.max(beneficiaries, 0) * (insight.suitabilityScore / 100));
        const greenPressureDelta = Number((-(Math.max(0, (records.row2024.ndvi || 0.2) - 0.15) * 0.12)).toFixed(3));
        const congestionShiftPct = Number((((records.row2024.density || 0) * 100) * 0.04 - (insight.suitabilityScore * 0.015)).toFixed(2));
        const infraLoadIndex = clamp(Number(((beneficiaries / 12000) + ((records.row2024.density || 0) * 60)).toFixed(2)), 5, 100);

        return res.json({
            wardNo: parsedWard,
            projectType,
            budget,
            policyPreset,
            suitabilityScore: insight.suitabilityScore,
            servicedPopulation,
            greenPressureDelta,
            congestionShiftPct,
            infraLoadIndex,
            keyRisks: insight.riskTags
        });
    } catch (err) {
        console.error('Impact Simulation Error:', err);
        return res.status(500).json({ message: 'Unable to simulate impact.' });
    }
};

const generateReport = async (req, res) => {
    try {
        const {
            wardNo,
            projectType = 'housing',
            priority = 'balanced',
            budget = 'medium',
            policyPreset = 'baseline'
        } = req.body || {};

        const parsedWard = parseWardNumber(wardNo);
        if (parsedWard === null) {
            return res.status(400).json({ message: 'Valid wardNo is required for report generation.' });
        }

        const [wardRecommendation, scenarioPack, livePack, feedbackStats] = await Promise.all([
            getWardRecommendationPayload(parsedWard, { projectType, priority, budget, policyPreset }),
            getScenarioRankingData({ projectType, priority, budget, policyPreset, limit: 5 }),
            (async () => {
                const wardRecord = await Ward.findOne({ wardNo: parsedWard, year: 2024 }).lean();
                return {
                    wardSignals: wardRecord ? getSignalBundle(parsedWard, wardRecord) : null,
                    generatedAt: new Date().toISOString()
                };
            })(),
            FeedbackLog.aggregate([
                { $match: { wardNo: parsedWard } },
                { $group: { _id: '$verdict', count: { $sum: 1 } } }
            ])
        ]);

        return res.json({
            generatedAt: new Date().toISOString(),
            title: `Planning Report - Ward ${parsedWard}`,
            scenario: { projectType, priority, budget, policyPreset },
            wardRecommendation: wardRecommendation.payload,
            topScenarioWards: scenarioPack.topWards,
            liveSignals: livePack.wardSignals,
            feedbackSummary: feedbackStats,
            notes: [
                'This report is generated from 2018 and 2024 historical records with projected 2026 trends.',
                'Use this as a decision-support artifact along with field verification.'
            ]
        });
    } catch (err) {
        console.error('Report Generation Error:', err);
        return res.status(500).json({ message: 'Unable to generate report right now.' });
    }
};

const submitFeedback = async (req, res) => {
    try {
        const { wardNo, verdict, note, scenario } = req.body || {};
        const parsedWard = parseWardNumber(wardNo);
        if (parsedWard === null) {
            return res.status(400).json({ message: 'Valid wardNo required.' });
        }

        const safeVerdict = ['positive', 'negative'].includes(verdict) ? verdict : 'positive';
        await FeedbackLog.create({
            wardNo: parsedWard,
            verdict: safeVerdict,
            note: String(note || '').slice(0, 300),
            scenario: scenario || {}
        });

        return res.json({ message: 'Feedback saved successfully.' });
    } catch (err) {
        console.error('Feedback Submit Error:', err);
        return res.status(500).json({ message: 'Unable to save feedback.' });
    }
};

const getFeedbackSummary = async (req, res) => {
    try {
        const aggregate = await FeedbackLog.aggregate([
            {
                $group: {
                    _id: '$verdict',
                    count: { $sum: 1 }
                }
            }
        ]);

        const summary = {
            positive: 0,
            negative: 0
        };

        aggregate.forEach((row) => {
            if (row._id === 'positive') summary.positive = row.count;
            if (row._id === 'negative') summary.negative = row.count;
        });

        return res.json(summary);
    } catch (err) {
        console.error('Feedback Summary Error:', err);
        return res.status(500).json({ message: 'Unable to fetch feedback summary.' });
    }
};

const getPredictedGrowth2026 = async (req, res) => {
    try {
        const [records2018, records2024] = await Promise.all([
            Ward.find({ year: 2018 }).lean(),
            Ward.find({ year: 2024 }).lean()
        ]);

        const byWard2018 = records2018.reduce((acc, row) => {
            acc[row.wardNo] = row;
            return acc;
        }, {});

        const predicted = records2024.map((row2024) => buildProjected2026Record(byWard2018[row2024.wardNo], row2024));
        return res.json(predicted);
    } catch (err) {
        console.error('Prediction Controller Error:', err);
        return res.status(500).json({
            message: 'Error generating 2026 projection'
        });
    }
};

module.exports = {
    getRecommendation,
    getChatRecommendation,
    getPredictedGrowth2026,
    getScenarioRanking,
    getPolicyPresets,
    getLiveSignals,
    simulateImpact,
    generateReport,
    submitFeedback,
    getFeedbackSummary
};