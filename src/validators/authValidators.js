const { z } = require('zod');

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

const verifyTwoFactorSchema = z.object({
  challenge_token: z.string().optional(),
  code: z.string().length(6),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const requestOtpSchema = z.object({
  email: z.string().email(),
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().min(1),
});

const resetPasswordSchema = z.object({
  reset_token: z.string().min(1),
  new_password: z.string().min(8),
});

module.exports = {
  loginSchema,
  refreshSchema,
  verifyTwoFactorSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  requestOtpSchema,
  verifyOtpSchema,
};
