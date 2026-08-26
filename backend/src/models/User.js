const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const addressSchema = new mongoose.Schema({
  firstName: { type: String, trim: true, maxlength: 50 },
  lastName: { type: String, trim: true, maxlength: 50 },
  line1: { type: String, trim: true, maxlength: 120 },
  line2: { type: String, trim: true, maxlength: 120 },
  city: { type: String, trim: true, maxlength: 80 },
  state: { type: String, trim: true, maxlength: 80 },
  zip: { type: String, trim: true, maxlength: 20 },
  country: { type: String, trim: true, uppercase: true, maxlength: 2, default: 'US' },
  phone: { type: String, trim: true, maxlength: 40 },
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
  },
  password: {
    type: String,
    minlength: [8, 'Password must be at least 8 characters'],
    select: false,
  },
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name too long'],
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: [50, 'Last name too long'],
  },
  phone: { type: String, trim: true, maxlength: 40 },
  authVersion: { type: Number, default: 0, min: 0 },
  role: {
    type: String,
    enum: ['customer', 'admin'],
    default: 'customer',
  },
  isEmailVerified: { type: Boolean, default: false },
  emailVerificationToken: { type: String, select: false },
  emailVerificationExpires: { type: Date, select: false },
  passwordResetToken: { type: String, select: false },
  passwordResetExpires: { type: Date, select: false },
  googleId: { type: String, sparse: true },
  avatar: { type: String },
  defaultAddress: addressSchema,
  addresses: [addressSchema],
  stripeCustomerId: { type: String },
  isActive: { type: Boolean, default: true },
  lastLoginAt: { type: Date },
}, {
  timestamps: true,
  toJSON: {
    transform: (doc, ret) => {
      delete ret.password;
      delete ret.emailVerificationToken;
      delete ret.emailVerificationExpires;
      delete ret.passwordResetToken;
      delete ret.passwordResetExpires;
      delete ret.authVersion;
      return ret;
    },
  },
});

// Hash password before saving
// Using promise-based pre-save hook (Mongoose 8+ / Node 24 compatible)
userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Virtual for full name
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

module.exports = mongoose.model('User', userSchema);
