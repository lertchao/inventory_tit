// module.exports = (req, res, next) => {
//     if (!req.session.user) {
//         return res.redirect(`/login?returnUrl=${encodeURIComponent(req.originalUrl)}`);
//     }
//     next();
// };

function isAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
      req.user = req.session.user;
      return next();
    } else {
      return res.redirect("/login");
    }
  }
  
  function isAdmin(req, res, next) {
    if (req.session?.user?.role === "admin") {
      return next();
    } else {
      return res.status(403).send("⛔ Forbidden: Admins only.");
    }
  }
  
  module.exports = {
    isAuthenticated,
    isAdmin
  };
  