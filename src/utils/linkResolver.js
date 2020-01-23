exports.linkResolver = function linkResolver(doc) {
  
  // Route for blog posts
  if (doc.type === "post") {
    return "/blog/" + doc.uid
  }

  if (doc._meta && doc._meta.type === "post") {
    return "/blog/" + doc._meta.uid
  }
  // Homepage route fallback
  return "/"
}