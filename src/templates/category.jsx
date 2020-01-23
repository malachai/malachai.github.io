import Helmet from "react-helmet";
import Layout from "../layout";
import PostListing from "../components/PostListing";
import React from "react";
import config from "../../data/SiteConfig";
import { graphql } from "gatsby";

export default class CategoryTemplate extends React.Component {
  render() {
    const { category } = this.props.pageContext;
    const postEdges = this.props.data.prismic.allPosts.edges;
    return (
      <Layout
        location={this.props.location}
        title={category.charAt(0).toUpperCase() + category.slice(1)}
      >
        <div className="category-container">
          <Helmet>
            <title>
              {`Posts in category "${category}" | ${config.siteTitle}`}
            </title>
            <link
              rel="canonical"
              href={`${config.siteUrl}/categories/${category}`}
            />
          </Helmet>
          <PostListing postEdges={postEdges} />
        </div>
      </Layout>
    );
  }
}

export const pageQuery = graphql`
query CategoryQuery($category: String) {
    prismic {
      allPosts(sortBy: date_DESC, where: {category: $category}) {
        edges {
          node {
            _meta {
              id
              uid
              type
            }
            category
            title
            date
            excerpt
            image
            imageSharp {
                childImageSharp {
                fluid(maxWidth: 400, maxHeight: 250) {
                    ...GatsbyImageSharpFluid
                }
                }
            }
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
`;
