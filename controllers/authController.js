import jwt from "jsonwebtoken";
import User from "../models/User.js";

// Generate tokens
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { id: userId },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "1h" }
  );

  const refreshToken = jwt.sign(
    { id: userId },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "7d" }
  );

  return { accessToken, refreshToken };
};

// @desc    Register new user
// @route   POST /api/auth/signup
// @access  Public
export const signup = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const userExists = await User.findOne({ email });

    if (userExists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const user = await User.create({
      name,
      email,
      password,
    });

    if (user) {
      const { accessToken, refreshToken } = generateTokens(user._id);

      // Save refresh token to user
      user.refreshToken = refreshToken;
      await user.save();

      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        accessToken,
        refreshToken,
      });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Auth user & get tokens
// @route   POST /api/auth/login
// @access  Public
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (user && (await user.comparePassword(password))) {
      const { accessToken, refreshToken } = generateTokens(user._id);

      // Save refresh token to user
      user.refreshToken = refreshToken;
      await user.save();

      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        accessToken,
        refreshToken,
      });
    } else {
      res.status(401).json({ message: "Invalid email or password" });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh
// @access  Public
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ message: "Refresh token required" });
    }

    const user = await User.findOne({ refreshToken });

    if (!user) {
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    try {
      const decoded = jwt.verify(
        refreshToken,
        process.env.REFRESH_TOKEN_SECRET
      );
      const accessToken = jwt.sign(
        { id: decoded.id },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
      );

      res.json({ accessToken });
    } catch (error) {
      return res.status(401).json({ message: "Invalid refresh token" });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
export const logout = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user) {
      user.refreshToken = undefined;
      await user.save();
    }

    res.json({ message: "Logged out successfully" });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};
