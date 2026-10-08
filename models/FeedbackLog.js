const mongoose = require('mongoose');

const FeedbackLogSchema = new mongoose.Schema({
  wardNo: { type: Number, required: true },
  verdict: { type: String, enum: ['positive', 'negative'], required: true },
  note: { type: String, default: '' },
  scenario: {
    projectType: { type: String, default: 'housing' },
    priority: { type: String, default: 'balanced' },
    budget: { type: String, default: 'medium' },
    policyPreset: { type: String, default: 'baseline' }
  }
}, {
  collection: 'feedbacklogs',
  timestamps: true
});

module.exports = mongoose.model('FeedbackLog', FeedbackLogSchema);
