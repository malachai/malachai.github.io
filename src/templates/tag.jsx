import Helmet from "react-helmet"
import Layout from "../layout"
import PostListing from "../components/PostListing"
import React from "react"
import config from "../../data/SiteConfig"
import { graphql } from "gatsby"

export default class TagTemplate extends React.Component {
  render() {
    const { tagValue } = this.props.pageContext;
    const postEdges = this.props.data.prismic.allPosts.edges.filter(edge => edge.node.tags && (edge.node.tags.filter(tags => tags.tag.name === tagValue).length > 0));

    return (
      <Layout
        location={this.props.location}
        title={`Tagged in ${tagValue.charAt(0).toUpperCase() + tagValue.slice(1)}`}
      >
        <div className="tag-container">
          <Helmet>
            <title>{`Posts tagged as "${tagValue}" | ${config.siteTitle}`}</title>
            <link rel="canonical" href={`${config.siteUrl}/tags/${tagValue}`} />
          </Helmet>
          <PostListing postEdges={postEdges} />
        </div>
      </Layout>
    )
  }
}

export const pageQuery = graphql`
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
`
