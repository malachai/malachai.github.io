import "./PostInfo.scss";

import React, { Component } from "react";

import Avatar from "react-md/lib/Avatars";
import CardTitle from "react-md/lib/Cards/CardTitle";
import FontIcon from "react-md/lib/FontIcons";
import { Link } from "gatsby";
import _ from "lodash";
import config from "../../../data/SiteConfig";
import moment from "moment";

class PostInfo extends Component {
  render() {
    const { postNode } = this.props;   
    return (
      <div className="post-info">
        <CardTitle
          avatar={<Avatar icon={<FontIcon iconClassName="fa fa-calendar" />} />}
          title={`Published on ${moment(postNode.date).format(
            config.dateFormat
          )}`}
          // subtitle={`${postNode.timeToRead} min read`}
        />
        <Link
          className="category-link"
          to={`/categories/${_.kebabCase(postNode.category)}`}
        >
          <CardTitle
            avatar={
              <Avatar icon={<FontIcon iconClassName="fa fa-folder-open" />} />
            }
            title="In category"
            subtitle={postNode.category}
          />
        </Link>
      </div>
    );
  }
}

export default PostInfo;
