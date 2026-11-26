import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  plan: {
    type: String,
    enum: ['free', 'startup', 'enterprise'],
    default: 'free'
  },
  status: {
    type: String,
    enum: ['active', 'past_due', 'canceled', 'trialing'],
    default: 'active'
  },
  currentPeriodStart: {
    type: Date,
    default: Date.now
  },
  currentPeriodEnd: {
    type: Date,
    required: true
  },
  usageLimits: {
    maxAgents: { type: Number, default: 3 },
    maxWorkflows: { type: Number, default: 5 },
    maxTokensPerMonth: { type: Number, default: 100000 }
  },
  usageCount: {
    tokensUsed: { type: Number, default: 0 },
    agentsCreated: { type: Number, default: 0 }
  },
  stripeSubscriptionId: {
    type: String
  }
}, {
  timestamps: true
});

const Subscription = mongoose.model('Subscription', subscriptionSchema);
export default Subscription;