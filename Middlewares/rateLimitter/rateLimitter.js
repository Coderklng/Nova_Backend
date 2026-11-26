import rateLimit from "express-rate-limit";

export const loginLimit = rateLimit({
     windowMs:15*60*100,
     max:5,
     message: { message: 'Too many login attempts, please try again after 15 minutes' },
     standardHeaders:true,
     legacyHeaders:true
})