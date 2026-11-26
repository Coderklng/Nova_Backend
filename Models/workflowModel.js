import mongoose from 'mongoose';

const workflowSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  trigger: {
    eventType: { type: String, required: true },
    conditions: { type: Object, default: {} }
  },
  actions: [{
    stepNumber: { type: Number, required: true },
    actionType: { type: String, required: true },
    config: { type: Object, required: true }
  }],
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isEnabled: {
    type: Boolean,
    default: true
  },
  executionCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

const Workflow = mongoose.model('Workflow', workflowSchema);
export default Workflow;