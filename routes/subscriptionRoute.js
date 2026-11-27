import express from 'express';
import {
  createSubscription,
  getMySubscription,
  getMySubscriptions,
  getSubscriptionById,
  updateSubscription,
  deleteSubscription,
} from '../Controllers/subscriptionController.js';
import { protect,authorizeAdmin } from "../Middlewares/auth/jwtVerification.js";

const subscriptionRoute = express.Router();

subscriptionRoute.use(protect);

subscriptionRoute.post('/', createSubscription);
subscriptionRoute.get('/me', getMySubscription);
subscriptionRoute.get('/my-all', getMySubscriptions);
subscriptionRoute.get('/:id', getSubscriptionById);
subscriptionRoute.put('/:id', updateSubscription);
subscriptionRoute.delete('/:id', deleteSubscription);


export default subscriptionRoute;