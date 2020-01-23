import "./PostSuggestions.scss";

import React, { Component } from "react";

import FontIcon from "react-md/lib/FontIcons";
import { Link } from "gatsby";

export default class PostSuggestions extends Component {
  render() {
    const { prevPath, prevTitle, nextPath, nextTitle } = this.props;

    return (
      <div className="post-suggestions md-grid md-cell--12">
        <Link to={prevPath} className="post-suggestion">
          <FontIcon
            forceFontSize
            forceSize={64}
            className="secondary-color arrow-nav"
          >
            arrow_back
          </FontIcon>
          <div className="headline-container hide-on-mobile">
            <h2 className="md-body-2 secondary-color">Previous</h2>
            <h6 className="md-headline secondary-color">{prevTitle}</h6>
          </div>
        </Link>
        <Link to={nextPath} className="post-suggestion">
          <div className="headline-container">
            <h2 className="md-body-2 secondary-color">Next</h2>
            <h6 className="md-headline secondary-color">{nextTitle}</h6>
          </div>
          <FontIcon
            forceFontSize
            forceSize={64}
            className="secondary-color arrow-nav"
          >
            arrow_forward
          </FontIcon>
        </Link>
      </div>
    );
  }
}
