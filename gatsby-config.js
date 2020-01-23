module.exports = {
  siteMetadata: {
    title: `Missing Wires`,
    author: `Matt Watson`,
    description: `Matt's Blog.`,
    siteUrl: `https://missingwires.com/`
  },
  plugins: [
    `gatsby-plugin-react-helmet`,
    `gatsby-plugin-sass`,
    `gatsby-transformer-sharp`,
    `gatsby-plugin-sharp`,
    {
      resolve: `gatsby-source-prismic-graphql`,
      options: {
        repositoryName: 'missingwires',
        previews: true,
        path: '/preview',
        pages: [{
          type: 'Post',
          match: '/blog/:uid',
          path: '/blog-preview',
          component: require.resolve('./src/templates/post.jsx')
        }]
      }
    },
  ],
  }
