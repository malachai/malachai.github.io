import "./b16-tomorrow-dark.css";
import "./post.scss";

import Card from "react-md/lib/Cards";
import CardText from "react-md/lib/Cards/CardText";
import Helmet from "react-helmet";
import Layout from "../layout";
import PostCover from "../components/PostCover";
import PostInfo from "../components/PostInfo";
import PostTags from "../components/PostTags";
import React from "react";
import { RichText } from "prismic-reactjs";
import SEO from "../components/SEO";
import SocialLinks from "../components/SocialLinks";
import UserInfo from "../components/UserInfo";
import config from "../../data/SiteConfig";
import { graphql } from "gatsby";
import { linkResolver } from "../utils/linkResolver"
import urljoin from "url-join";

export const query = graphql`
query BlogPostQuery($uid: String) {
  prismic {
    allPosts(uid: $uid) {
      edges {
        node {
          post_body
          title
          category
          date
          excerpt
          tags {
            tag {
              _linkType
              ... on PRISMIC_Tag {
                name
                _linkType
              }
            }
          }
          image
          imageSharp {
            childImageSharp {
              fluid(maxWidth: 400, maxHeight: 250) {
                ...GatsbyImageSharpFluid
              }
            }
          }
        }
      }
    }
  }
}
`

export default ({ data }) => {
  const doc = data.prismic.allPosts.edges.slice(0, 1).pop()  
  // const { mobile } = this.state;  
  //const { location } = this.props;  
  const expanded = true; //!mobile;
  const postOverlapClass = "post-overlap"; //mobile ? "post-overlap-mobile" : "post-overlap";  
  if (!doc) return null
    
  const coverHeight = 350; //mobile ? 180 : 350;
  const canonicalUrl = urljoin(config.siteUrl, config.pathPrefix, linkResolver(doc.node));

  return (    
    <Layout title={`${doc.node.category ? doc.node.category : ''} Post`}>
        <div className="post-page md-grid md-grid--no-spacing">
          <Helmet>
            <title>{`${doc.node.title} | ${config.siteTitle}`}</title>
            <link rel="canonical" href={canonicalUrl} />
          </Helmet>
          <SEO postPath={linkResolver(doc.node)} postNode={doc.node} postSEO />
          <PostCover
            postNode={doc.node}
            coverHeight={coverHeight}
            coverClassName="md-grid md-cell--9 post-cover"
          />
          <div
            className={`md-grid md-cell--9 post-page-contents mobile-fix ${postOverlapClass}`}
          >
            <Card className="md-grid md-cell md-cell--12 post">
              <CardText className="post-body">
                <h1 className="md-display-2 post-header">{doc.node.title}</h1>
                <PostInfo postNode={doc.node} />
                {RichText.render(doc.node.post_body)}
              </CardText>
              <div className="post-meta">
                <PostTags tags={doc.node.tags.map(x => x.tag == null ? null : x.tag.name)} />
                <SocialLinks
                  postPath={linkResolver(doc.node)}
                  postNode={doc.node}
                  mobile={false}
                  // mobile={mobile}
                />
              </div>
            </Card>
            <UserInfo
              className="md-grid md-cell md-cell--12"
              config={config}
              expanded={expanded}
            />            
          </div>
          {/* <PostSuggestions
            prevPath={prevpath}
            prevTitle={prevtitle}
            nextPath={nextpath}
            nextTitle={nexttitle}
          /> */}
        </div>
      </Layout>
  )
}