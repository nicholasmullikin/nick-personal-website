const React = require("react")
const ReactDOM = require("react-dom/client")

exports.replaceHydrateFunction = () => {
  return (element, container) => {
    const root = ReactDOM.createRoot(container)
    root.render(element)
  }
}

const { EarthBackgroundRoot } = require("./src/components/earthBackground")
exports.wrapPageElement = ({ element, props }) =>
  React.createElement(
    EarthBackgroundRoot,
    { pathname: props.location.pathname },
    element,
  )
