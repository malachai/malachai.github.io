const config = {
    siteTitle: "Missingwires Blog",
    siteTitleShort: "Missingwires",
    siteTitleAlt: "Missingwires Blog Site",
    siteLogo: "/logos/logo-1024.png",
    siteUrl: "https://missingwires.com",
    pathPrefix: "/",
    fixedFooter: false,
    siteDescription: "Missing Wires Blog", // Website description used for RSS feeds/meta description tag.
    siteRss: "/rss.xml", // Path to the RSS file.
    siteFBAppID: "ABC!@#", // FB Application ID for using app insights
    siteGATrackingID: "UA-12345678-9", // Tracking code ID for google analytics.
    disqusShortname: "disqusShortname", // Disqus shortname.
    postDefaultCategory: "Tech", // Default category for posts.
    dateFromFormat: "YYYY-MM-DD", // Date format used in the frontmatter.
    dateFormat: "DD/MM/YYYY", // Date format for display.
    userName: "Matt Watson", // Username to display in the author segment.
    userEmail: "blog@missingwires.com", // Email used for RSS feed's author segment
    userTwitter: "", // Optionally renders "Follow Me" in the UserInfo segment.
    userLocation: "North Pole, Earth", // User location to display in the author segment.
    userAvatar: "https://api.adorable.io/avatars/150/blog@missingwires.com.png", // User avatar to display in the author segment.
    userDescription:
      "Trusted Technical Advisor", // User description to display in the author segment.    
    userLinks: [
      {
        label: "GitHub",
        url: "https://github.com/",
        iconClassName: "fa fa-github"
      },
      {
        label: "Twitter",
        url: "https://twitter.com/",
        iconClassName: "fa fa-twitter"
      },
      {
        label: "Email",
        url: "mailto:blog@missingwires.com",
        iconClassName: "fa fa-envelope"
      }
    ],
    copyright: "Copyright © 2020" // Copyright string for the footer of the website and RSS feed.
  };
  
  // Validate
  
  // Make sure pathPrefix is empty if not needed
  if (config.pathPrefix === "/") {
    config.pathPrefix = "";
  } else {
    // Make sure pathPrefix only contains the first forward slash
    config.pathPrefix = `/${config.pathPrefix.replace(/^\/|\/$/g, "")}`;
  }
  
  // Make sure siteUrl doesn't have an ending forward slash
  if (config.siteUrl.substr(-1) === "/")
    config.siteUrl = config.siteUrl.slice(0, -1);
  
  // Make sure siteRss has a starting forward slash
  if (config.siteRss && config.siteRss[0] !== "/")
    config.siteRss = `/${config.siteRss}`;
  
  module.exports = config;
  