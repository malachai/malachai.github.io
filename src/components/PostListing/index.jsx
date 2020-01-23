import PostPreview from "../PostPreview";
import React from "react";
import { linkResolver } from "../../utils/linkResolver"

class PostListing extends React.Component {
  getPostList() {
    const postList = [];
    this.props.postEdges.forEach(postEdge => {
      postList.push({
        path: linkResolver(postEdge.node),
        tags: postEdge.node.tags.map(x => x.tag == null ? null : x.tag.name),
        imageSharp: postEdge.node.imageSharp,
        title: postEdge.node.title,
        category: postEdge.node.category,
        date: postEdge.node.date,
        excerpt: postEdge.node.excerpt
      });
    });
    return postList;
  }
  render() {
    const postList = this.getPostList();
    return (
      <div className="md-grid md-grid--no-spacing md-cell--middle">
        <div className="md-grid md-cell--8 mobile-fix">
          {postList.map(post => (
            <PostPreview key={post.title} postInfo={post} />
          ))}
        </div>
      </div>
    );
  }
}

export default PostListing;
