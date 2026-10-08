const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/recommendationController');

router.post('/analyze-site', getRecommendation);
router.post('/chat', getChatRecommendation);
router.get('/predict-2026', getPredictedGrowth2026);
router.post('/scenario-rank', getScenarioRanking);
router.get('/policy-presets', getPolicyPresets);
router.get('/live-signals', getLiveSignals);
router.post('/impact-simulate', simulateImpact);
router.post('/report', generateReport);
router.post('/feedback', submitFeedback);
router.get('/feedback-summary', getFeedbackSummary);

module.exports = router; // This line is critical!