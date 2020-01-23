import "./UserInfo.scss";

import React, { Component } from "react";

import Avatar from "react-md/lib/Avatars";
import Card from "react-md/lib/Cards/Card";
import CardText from "react-md/lib/Cards/CardText";
import CardTitle from "react-md/lib/Cards/CardTitle";
import FontIcon from "react-md/lib/FontIcons";
import IconSeparator from "react-md/lib/Helpers/IconSeparator";
import UserLinks from "../UserLinks";

// import { Follow } from "react-twitter-widgets";



class UserInfo extends Component {
  render() {
    const {
      userAvatar,
      userName,
      userLocation,
      userDescription,
      userLinks,
      // userTwitter
    } = this.props.config;
    const { expanded } = this.props;
    const userLinksElement = (
      <UserLinks config={this.props.config} labeled={expanded} />
    );
    if (!userAvatar && !userName && !userLocation && !userDescription) {
      if (userLinks) {
        return (
          <Card className="md-grid md-cell md-cell--12 user-info">
            {userLinksElement}
          </Card>
        );
      }
      return null;
    }
    return (
      <Card className="md-grid md-cell md-cell--12 user-info">
        <CardTitle
          expander={!expanded}
          avatar={userAvatar && <Avatar src={userAvatar} role="presentation" />}
          title={userName && userName}
          subtitle={
            // userTwitter ? (
            //   <Follow
            //     username={userTwitter}
            //     options={{ count: expanded ? "none" : "none" }}
            //   />
            // ) : (
            //   "Author"
            // )
            "Author"
          }
        />
        <CardText expandable={!expanded}>
          {userLocation && (
            <IconSeparator label={userLocation} iconBefore>
              <FontIcon iconClassName="fa fa-map-marker" />
            </IconSeparator>
          )}
          <p>{userDescription && userDescription}</p>
          {userLinksElement}
        </CardText>
      </Card>
    );
  }
}

export default UserInfo;
