import mongoose from 'mongoose';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    plan: {
      type: String,
      enum: ['free', 'startup', 'enterprise'],
      default: 'free',
    },
    status: {
      type: String,
      enum: ['active', 'past_due', 'canceled', 'trialing'],
      default: 'active',
    },
    currentPeriodStart: {
      type: Date,
      default: Date.now,
    },
    currentPeriodEnd: {
      type: Date,
      default: () => new Date(Date.now() + THIRTY_DAYS_MS),
    },
    usageLimits: {
      maxAgents: { type: Number, default: 3 },
      maxWorkflows: { type: Number, default: 5 },
      maxTokensPerMonth: { type: Number, default: 100000 },
      freeDailyChatLimit: { type: Number, default: 20 },
    },
    usageCount: {
      tokensUsed: { type: Number, default: 0 },
      agentsCreated: { type: Number, default: 0 },
      workflowsCreated: { type: Number, default: 0 },
      dailyChatCount: { type: Number, default: 0 },
    },
    sessionResetAt: {
      type: Date,
      default: null,
    },
    stripeSubscriptionId: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

const Subscription = mongoose.model('Subscription', subscriptionSchema);
export default Subscription;