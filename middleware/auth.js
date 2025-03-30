module.exports = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect(`/login?returnUrl=${encodeURIComponent(req.originalUrl)}`);
    }
    next();
};

