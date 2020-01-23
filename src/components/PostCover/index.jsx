import "./PostCover.scss";

import React, { Component } from "react";

import Img from "gatsby-image";

class PostCover extends Component {
  render() {    
    const { postNode, coverHeight, coverClassName } = this.props;    
    if(postNode.imageSharp == null || postNode.imageSharp.childImageSharp == null || postNode.imageSharp.childImageSharp.fluid == null)
    {
      if(postNode.image.url)
      {
          return (
            <img 
              src={postNode.image.url} 
              outerWrapperClassName={coverClassName}
              style={{ height: coverHeight, width: "100%" }}
              alt="Blog Header"
            />
          );
      }
      else
        return false;
    }
    return (
      <Img
          fluid={postNode.imageSharp.childImageSharp.fluid}
          outerWrapperClassName={coverClassName}
          style={{ height: coverHeight, width: "100%" }}
        />
    );
  }
}

export default PostCover;