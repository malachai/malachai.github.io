import "font-awesome/scss/font-awesome.scss";
import "./index.scss";
import "./global.scss";

import Helmet from "react-helmet";
import Navigation from "../components/Navigation";
import React from "react";
import config from "../../data/SiteConfig";

export default class MainLayout extends React.Component {
  render() {
    const { children } = this.props;
    return (
      <Navigation config={config} LocalTitle={this.props.title}>
        <div>
          <Helmet>
            <meta name="description" content={config.siteDescription} />
          </Helmet>
          {children}
        </div>
      </Navigation>
    );
  }
}
