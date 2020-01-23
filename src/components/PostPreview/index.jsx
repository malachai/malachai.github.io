import "./PostPreview.scss"

import Media, { MediaOverlay } from "react-md/lib/Media"
import React, { Component } from "react"

import Avatar from "react-md/lib/Avatars"
import Button from "react-md/lib/Buttons"
import Card from "react-md/lib/Cards/Card"
import CardText from "react-md/lib/Cards/CardText"
import CardTitle from "react-md/lib/Cards/CardTitle"
import FontIcon from "react-md/lib/FontIcons"
import { Link } from "gatsby"
import PostCover from "../PostCover"
import PostTags from "../PostTags"
import _ from "lodash"
import config from "../../../data/SiteConfig"
import moment from "moment"

class PostPreview extends Component {
  constructor(props) {
    super(props)
    this.state = {
      mobile: true,
    }
    this.handleResize = this.handleResize.bind(this)
  }
  componentDidMount() {
    this.handleResize()
    window.addEventListener("resize", this.handleResize)
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.handleResize)
  }

  handleResize() {
    if (window.innerWidth >= 640) {
      this.setState({ mobile: false })
    } else {
      this.setState({ mobile: true })
    }
  }

  render() {
    const { postInfo } = this.props
    const { mobile } = this.state
    const expand = mobile
    /* eslint no-undef: "off" */
    const coverHeight = mobile ? 162 : 225    
    return (
      <Card key={postInfo.path} raise className="md-grid md-cell md-cell--12">
        <Link style={{ textDecoration: "none" }} to={postInfo.path}>
          <Media style={{ height: coverHeight, paddingBottom: "0px" }}>
            <PostCover postNode={postInfo} coverHeight={coverHeight} />
            <MediaOverlay>
              <CardTitle title={postInfo.title}>
                <Button raised secondary className="md-cell--right">
                  Read
                </Button>
              </CardTitle>
            </MediaOverlay>
          </Media>
        </Link>
        <CardTitle
          expander={expand}
          avatar={<Avatar icon={<FontIcon iconClassName="fa fa-calendar" />} />}
          title={`Published on ${moment(postInfo.date).format(
            config.dateFormat
          )}`}
          subtitle={
            <div>
              <span>Category: </span>
              <Link
                className="category-link"
                to={`/categories/${_.kebabCase(postInfo.category)}`}
              >
                {postInfo.category}
              </Link>
            </div>
          }
        />
        <CardText expandable={expand}>
          {postInfo.excerpt}
          <PostTags tags={postInfo.tags} />
        </CardText>
      </Card>
    )
  }
}

export default PostPreview
