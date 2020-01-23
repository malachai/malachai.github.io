const path = require("path");
const _ = require("lodash");
const { getRootQuery } = require("gatsby-source-graphql-universal/getRootQuery");
const { linkResolver } = require("./src/utils/linkResolver")

exports.createPages = async ({ graphql, actions }) => {
    const { createPage } = actions;    
    const tagPage = path.resolve("src/templates/tag.jsx");
    const categoryPage = path.resolve("src/templates/category.jsx");    

    const prismicQueryResult = await graphql(
      `
      {
        prismic {
          allPosts(sortBy: date_DESC) {
            edges {
              node {
                _meta {
                  id
                  uid
                  type
                }
                title
                category
                date
                tags {
                  tag {
                    _linkType
                    ... on PRISMIC_Tag {
                      name
                      _linkType
                    }
                  }
                }
              }
            }
          }
        }
      }
      `
    );
  
    if (prismicQueryResult.errors) {
      console.error(prismicQueryResult.errors);
      throw prismicQueryResult.errors;
    }
  
    const tagSet = new Set();
    const categorySet = new Set();
  
    const postsEdges = prismicQueryResult.data.prismic.allPosts.edges;
  
    postsEdges.forEach((edge, index) => {
      
      if(edge.node.tags)
      {
        edge.node.tags.forEach(tags => {
          tagSet.add(tags.tag.name);
        })
      }      
      if(edge.node.category)
      {
        categorySet.add(edge.node.category);
      }
    });
  
    tagSet.forEach(tagValue => {
      createPage({
        path: `/tags/${_.kebabCase(tagValue)}/`,
        component: tagPage,
        context: {
          tagValue
        }
      });
    });
    categorySet.forEach(category => {
      createPage({
        path: `/categories/${_.kebabCase(category)}/`,
        component: categoryPage,
        context: {
          category
        }
      });
    });    
  };