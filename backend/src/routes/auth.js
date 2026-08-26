const express = require('express');
const { generateState, buildGoogleAuthUrl, exchangeCodeForTokens, getGoogleUserInfo } = require('../utils/googleOAuth');
const crypto = require('crypto');

// One-time tokens (email verification, password reset) are stored HASHED.
// A database leak then exposes only sha256 digests — useless for account
// takeover — while the raw token lives solely in the email we send.
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const { body } = require('express-validator');
const User = require('../models/User');
const { validate } = require('../middleware/validate');
const {
  generateAccessToken,
  setAuthCookie,
  clearAuthCookie,
  authenticate,
} = require('../middleware/auth');
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
} = require('../utils/email');
const { assertPermanentEmail } = require('../utils/disposableEmail');
const { mergeGuestCartForUser } = require('../utils/guestCartMerge');
const { validGuestSessionId } = require('../utils/guestSession');

const router = express.Router();
const bcryptPasswordBytes = (value) => {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 72) {
    throw new Error('Password must be at most 72 UTF-8 bytes');
  }
  return true;
};

// ─── POST /api/auth/signup ─────────────────────────────────────────────────────
router.post(
  '/signup',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password')
      .isLength({ min: 8, max: 72 })
      .withMessage('Password must be between 8 and 72 characters')
      .custom(bcryptPasswordBytes)
      .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter')
      .matches(/[0-9]/).withMessage('Password must contain at least one number'),
    body('firstName').trim().notEmpty().withMessage('First name required').isLength({ max: 50 }),
    body('lastName').trim().notEmpty().withMessage('Last name required').isLength({ max: 50 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { email, password, firstName, lastName } = req.body;

      assertPermanentEmail(email);

      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      // Generate verification token
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

      const user = await User.create({
        email,
        password,
        firstName,
        lastName,
        emailVerificationToken: hashToken(verificationToken),
        emailVerificationExpires: verificationExpires,
      });

      const sessionId = validGuestSessionId(req.body.sessionId) || validGuestSessionId(req.cookies?.cartSessionId);
      await mergeGuestCartForUser(user._id, sessionId);

      // Send verification email (non-blocking)
      try {
        await sendVerificationEmail({
          email: user.email,
          firstName: user.firstName,
          token: verificationToken,
        });
      } catch (emailErr) {
        console.error('Verification email failed:', emailErr.message);
      }

      const token = generateAccessToken(user._id, user.authVersion);
      setAuthCookie(res, token);

      res.status(201).json({
        message: 'Account created. Please check your email to verify your account.',
        token,
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
        },
      });
    } catch (err) {
      if (err.code === 'DISPOSABLE_EMAIL_BLOCKED') {
        return res.status(err.statusCode || 400).json({ error: err.message, code: err.code });
      }
      console.error('Signup error:', err);
      res.status(500).json({ error: 'Failed to create account' });
    }
  }
);

// ─── POST /api/auth/login ──────────────────────────────────────────────────────
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password')
      .isString()
      .notEmpty().withMessage('Password required')
      .isLength({ max: 256 }).withMessage('Password is too long'),
  ],
  validate,
  async (req, res) => {
    try {
      const { email, password } = req.body;

      const user = await User.findOne({ email }).select('+password +googleId');
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      // Account exists but was created via Google (no password set). Tell the
      // user to use the Google button instead of failing generically.
      if (!user.password) {
        if (user.googleId) {
          return res.status(401).json({
            error: 'This account uses Google sign-in. Please continue with Google.',
          });
        }
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (!user.isActive) {
        return res.status(403).json({ error: 'Account has been deactivated' });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Update last login
      user.lastLoginAt = new Date();
      await user.save({ validateBeforeSave: false });

      const sessionId = validGuestSessionId(req.body.sessionId) || validGuestSessionId(req.cookies?.cartSessionId);
      await mergeGuestCartForUser(user._id, sessionId);

      const token = generateAccessToken(user._id, user.authVersion);
      setAuthCookie(res, token);

      res.json({
        message: 'Logged in successfully',
        token,
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
          avatar: user.avatar,
        },
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

// ─── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ message: 'Logged out successfully' });
});

// ─── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  res.json({ user: req.user });
});

// ─── POST /api/auth/verify-email ──────────────────────────────────────────────
router.post(
  '/verify-email',
  [body('token').matches(/^[a-f0-9]{64}$/i).withMessage('Invalid verification token')],
  validate,
  async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    const user = await User.findOne({
      emailVerificationToken: hashToken(token),
      emailVerificationExpires: { $gt: new Date() },
    }).select('+emailVerificationToken +emailVerificationExpires');

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });

    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    console.error('Email verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
  },
);

// ─── POST /api/auth/resend-verification ───────────────────────────────────────
router.post('/resend-verification', authenticate, async (req, res) => {
  try {
    if (req.user.isEmailVerified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await User.findByIdAndUpdate(req.user._id, {
      emailVerificationToken: hashToken(verificationToken),
      emailVerificationExpires: verificationExpires,
    });

    await sendVerificationEmail({
      email: req.user.email,
      firstName: req.user.firstName,
      token: verificationToken,
    });

    res.json({ message: 'Verification email sent' });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Failed to send verification email' });
  }
});

// ─── POST /api/auth/forgot-password ───────────────────────────────────────────
router.post(
  '/forgot-password',
  [body('email').isEmail().normalizeEmail().withMessage('Valid email required')],
  validate,
  async (req, res) => {
    try {
      const { email } = req.body;
      const user = await User.findOne({ email });

      // Always return success to prevent email enumeration
      if (!user) {
        return res.json({ message: 'If an account exists, a reset email has been sent.' });
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await User.findByIdAndUpdate(user._id, {
        passwordResetToken: hashToken(resetToken),
        passwordResetExpires: resetExpires,
      });

      try {
        await sendPasswordResetEmail({
          email: user.email,
          firstName: user.firstName,
          token: resetToken,
        });
      } catch (emailErr) {
        // Log full error so you can see what's wrong in server logs
        console.error('Password reset email failed:', emailErr.message, emailErr);
      }

      res.json({ message: 'If an account exists, a reset email has been sent.' });
    } catch (err) {
      console.error('Forgot password error:', err);
      res.status(500).json({ error: 'Failed to process request' });
    }
  }
);

// ─── POST /api/auth/reset-password ────────────────────────────────────────────
router.post(
  '/reset-password',
  [
    body('token').matches(/^[a-f0-9]{64}$/i).withMessage('Invalid reset token'),
    body('password')
      .isLength({ min: 8, max: 72 })
      .withMessage('Password must be between 8 and 72 characters')
      .custom(bcryptPasswordBytes)
      .matches(/[A-Z]/).withMessage('Must contain uppercase letter')
      .matches(/[0-9]/).withMessage('Must contain a number'),
  ],
  validate,
  async (req, res) => {
    try {
      const { token, password } = req.body;

      const user = await User.findOne({
        passwordResetToken: hashToken(token),
        passwordResetExpires: { $gt: new Date() },
      }).select('+passwordResetToken +passwordResetExpires');

      if (!user) {
        return res.status(400).json({ error: 'Invalid or expired reset token' });
      }

      user.password = password;
      user.authVersion = (user.authVersion || 0) + 1;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save();

      clearAuthCookie(res);
      res.json({ message: 'Password reset successfully. Please log in.' });
    } catch (err) {
      console.error('Reset password error:', err);
      res.status(500).json({ error: 'Failed to reset password' });
    }
  }
);

// ─── PATCH /api/auth/profile ───────────────────────────────────────────────────
router.patch(
  '/profile',
  authenticate,
  [
    body('firstName').optional().trim().notEmpty().isLength({ max: 50 }),
    body('lastName').optional().trim().notEmpty().isLength({ max: 50 }),
    body('phone').optional().trim().isLength({ max: 40 }).withMessage('Phone number is too long'),
    body('defaultAddress').optional().isObject().withMessage('Default address must be an object'),
  ],
  validate,
  async (req, res) => {
    try {
      const { firstName, lastName, phone, defaultAddress } = req.body;
      const updates = {};
      if (firstName) updates.firstName = firstName;
      if (lastName) updates.lastName = lastName;
      if (phone !== undefined) updates.phone = phone;
      if (defaultAddress) {
        const limits = { firstName: 50, lastName: 50, line1: 120, line2: 120, city: 80, state: 80, zip: 20, country: 2, phone: 40 };
        const address = {};
        for (const [field, value] of Object.entries(defaultAddress)) {
          if (!Object.prototype.hasOwnProperty.call(limits, field)) continue;
          if (typeof value !== 'string' || value.trim().length > limits[field]) {
            return res.status(400).json({ error: `Invalid default address ${field}` });
          }
          address[field] = value.trim();
        }
        updates.defaultAddress = address;
      }

      const user = await User.findByIdAndUpdate(req.user._id, updates, {
        returnDocument: 'after',
        runValidators: true,
      });

      if (!user) return res.status(404).json({ error: 'User not found' });

      res.json({ user });
    } catch (err) {
      console.error('Profile update error:', err);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  }
);

// ─── POST /api/auth/change-password ───────────────────────────────────────────
router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword')
      .isString()
      .notEmpty().withMessage('Current password required')
      .isLength({ max: 256 }).withMessage('Current password is too long'),
    body('newPassword')
      .isLength({ min: 8, max: 72 })
      .withMessage('New password must be between 8 and 72 characters')
      .custom(bcryptPasswordBytes)
      .matches(/[A-Z]/).withMessage('Must contain uppercase letter')
      .matches(/[0-9]/).withMessage('Must contain a number'),
  ],
  validate,
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const user = await User.findById(req.user._id).select('+password');

      if (!user) return res.status(404).json({ error: 'User not found' });
      if (!user.password) {
        return res.status(400).json({ error: 'This account uses Google sign-in and has no password to change.' });
      }

      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }

      user.password = newPassword;
      user.authVersion = (user.authVersion || 0) + 1;
      // validateBeforeSave:false prevents other required fields from blocking this targeted update
      await user.save({ validateBeforeSave: false });

      // Revoke every previously issued token while keeping this verified
      // password-change session usable with a fresh versioned bearer.
      const token = generateAccessToken(user._id, user.authVersion);
      setAuthCookie(res, token);
      res.json({ message: 'Password changed successfully', token });
    } catch (err) {
      console.error('Change password error:', err);
      res.status(500).json({ error: 'Failed to change password' });
    }
  }
);

// ─── GET /api/auth/google ──────────────────────────────────────────────────────
router.get('/google', (req, res) => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CALLBACK_URL } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CALLBACK_URL) {
    return res.status(503).json({ error: 'Google OAuth not configured' });
  }
  const state = generateState();
  res.cookie('oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 10 * 60 * 1000,
  });
  res.redirect(buildGoogleAuthUrl(GOOGLE_CLIENT_ID, GOOGLE_CALLBACK_URL, state));
});

// ─── GET /api/auth/google/callback ────────────────────────────────────────────
router.get('/google/callback', async (req, res) => {
  const FRONTEND_URL = process.env.FRONTEND_URL || 'https://reflexityram.com';
  const fail = (reason) => res.redirect(`${FRONTEND_URL}/auth/callback?auth_error=${reason}`);

  const { code, error, state } = req.query;
  const storedState = req.cookies?.oauth_state;

  if (!state || !storedState || state !== storedState) {
    return fail('state_mismatch');
  }

  res.clearCookie('oauth_state', { httpOnly: true, secure: true, sameSite: 'none' });

  if (error || !code) return fail('google_denied');

  try {
    const tokens = await exchangeCodeForTokens(
      code,
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL
    );
    if (!tokens.access_token) return fail('token_exchange_failed');

    const profile = await getGoogleUserInfo(tokens.access_token);
    if (!profile.email) return fail('no_email');

    const email = profile.email.toLowerCase();
    let user = await User.findOne({ $or: [{ googleId: profile.id }, { email }] });

    if (user) {
      if (!user.googleId) user.googleId = profile.id;
      if (!user.avatar && profile.picture) user.avatar = profile.picture;
      if (!user.isEmailVerified) user.isEmailVerified = true;
      user.lastLoginAt = new Date();
      await user.save({ validateBeforeSave: false });
    } else {
      const nameParts = (profile.name || '').split(' ').filter(Boolean);
      // lastName is required on the User model. Google accounts with a
      // single-word name (no family_name) would otherwise produce an empty
      // lastName and fail validation → server_error. Fall back so creation
      // always succeeds; the user can edit it later in their profile.
      const firstName = profile.given_name || nameParts[0] || 'User';
      const lastName =
        profile.family_name ||
        nameParts.slice(1).join(' ') ||
        '—';
      user = await User.create({
        email,
        googleId: profile.id,
        firstName,
        lastName,
        avatar: profile.picture || null,
        isEmailVerified: true,
        isActive: true,
        lastLoginAt: new Date(),
      });
    }

    if (!user.isActive) return fail('account_deactivated');

    const sessionId = validGuestSessionId(req.cookies?.cartSessionId);
    await mergeGuestCartForUser(user._id, sessionId);

    const token = generateAccessToken(user._id, user.authVersion);
    setAuthCookie(res, token);

    // The fragment carries only the bearer needed for the frontend's
    // authoritative /auth/me lookup. Duplicating profile or role data in the
    // URL creates needless browser-history and extension exposure.
    res.redirect(`${FRONTEND_URL}/auth/callback#token=${token}`);
  } catch (err) {
    console.error('Google OAuth callback error:', err.message, err);
    fail('server_error');
  }
});

module.exports = router;
