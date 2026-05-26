const adminProtect = (req, res, next) => {
  if (!req.user || !['admin', 'developer'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Access denied. Admin or developer only.' });
  }
  next();
};

module.exports = { adminProtect };
