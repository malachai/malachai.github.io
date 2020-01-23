import Card from "react-md/lib/Cards";
import CardText from "react-md/lib/Cards/CardText";
import Helmet from "react-helmet";
import Layout from "../layout";
import React from "react";
import config from "../../data/SiteConfig";

class Index extends React.Component {
  render() {    
    return (
      <Layout location={this.props.location} title="404">
        <div className="index-container">
          <Helmet>
            <title>{config.siteTitle}</title>
            <link rel="canonical" href={`${config.siteUrl}`} />
          </Helmet>          
          <Card className="md-grid md-cell md-cell--12 post">
              <CardText>
                <h1 className="md-display-2 post-header">Page not found</h1>
                Please return <a href="/">home</a>
              </CardText>
            </Card>
        </div>
      </Layout>
    );
  }
}

export default Index;