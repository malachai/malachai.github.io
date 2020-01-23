var data = `
{
  "data": {
    "prismic": {
      "allPosts": {
        "edges": [
          {
            "node": {
              "_meta": {
                "id": "XhutWRUAACQAKBcm",
                "uid": "spe-oggraphimageurl",
                "type": "post"
              },
              "title": "SPE SXA Updating OgGraphImageUrl",
              "date": "2020-01-08",
              "excerpt": "This script will start at the $rootItem and for each child matching the $sourceTemplate will attempt to extract the Image field (if it exists) and copy this to the OpenGraphImageUrl field.",
              "tags": [
                {
                  "tag": {
                    "_linkType": "Link.document",
                    "name": "SXA"
                  }
                },
                {
                  "tag": {
                    "_linkType": "Link.document",
                    "name": "SPE"
                  }
                },
                {
                  "tag": {
                    "_linkType": "Link.document",
                    "name": "Sitecore"
                  }
                }
              ]
            }
          },
          {
            "node": {
              "_meta": {
                "id": "XhuthhUAACQAKBfW",
                "uid": "spe-create-item-for-media-item",
                "type": "post"
              },
              "title": "SPE Create Items based on Media Folder",
              "date": "2019-11-05",
              "excerpt": "This script walk through each item in the media folder and create a matching item (in this case setting the File and sxatags field) in the content tree",
              "tags": [
                {
                  "tag": {
                    "_linkType": "Link.document",
                    "name": "SXA"
                  }
                },
                {
                  "tag": {
                    "_linkType": "Link.document",
                    "name": "SPE"
                  }
                }
              ]
            }
          }
        ]
      }
    }
  }
}
`;

var json = JSON.parse(data);
const { tag } = "Sitecore"
const postEdges = json.data.prismic.allPosts.edges;

// const tagSet = new Set();

// postEdges.forEach((edge, index) => {
//   if(edge.node.tags)
//   {
//     edge.node.tags.forEach(tags => {
//       tagSet.add(tags.tag.name);
//     })
//   }
//   //   if (edge.node.frontmatter.tags) {
//   //     edge.node.frontmatter.tags.forEach(tag => {
//   //       tagSet.add(tag);
//   //     });
//   //   }
// });

// console.log(tagSet);

var test = postEdges.filter(edge => edge.node.tags && (edge.node.tags.filter(tags => tags.tag.name == tag).length > 0))

console.log(test)

// postEdges.forEach(postEdge => {
//     //console.log(postEdge.node._meta.uid);
//     //console.log(postEdge.node.tags.map(x => x.tag == null ? null : x.tag.name))
//     console.log(postEdge.node.title);
// });
