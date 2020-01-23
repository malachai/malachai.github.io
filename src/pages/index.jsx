import Helmet from "react-helmet";
import Layout from "../layout";
import PostListing from "../components/PostListing";
import React from "react";
import SEO from "../components/SEO";
import config from "../../data/SiteConfig";
import { graphql } from "gatsby";

export const query = graphql`
  {
    site {
      siteMetadata {
        title
      }
    }
    prismic {
      allHomepages {
        edges {
          node {
            headline
            description
            image
          }
        }
      }
      allPosts(sortBy: date_DESC) {
        edges {
          node {
            _meta {
              id
              uid
              type
            }
            title
            date
            image
            imageSharp {
              childImageSharp {
                fluid(maxWidth: 400, maxHeight: 250) {
                  ...GatsbyImageSharpFluid
                }
              }
            }
            excerpt
            category
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

class Index extends React.Component {
  render() {
    const postEdges = this.props.data.prismic.allPosts.edges;
    return (
      <Layout location={this.props.location} title="Home">
        <div className="index-container">
          <Helmet>
            <title>{config.siteTitle}</title>
            <link rel="canonical" href={`${config.siteUrl}`} />
          </Helmet>
          <SEO postEdges={postEdges} />
          <PostListing postEdges={postEdges} />
        </div>
      </Layout>
    );
  }
}

export default Index;