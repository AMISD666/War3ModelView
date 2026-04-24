import type { ForwardRefExoticComponent, RefAttributes } from "react";
import ViewerImpl from "./viewer/ViewerImpl";
import type { ViewerProps, ViewerRef } from "./viewer/ViewerTypes";

const Viewer = ViewerImpl as ForwardRefExoticComponent<ViewerProps & RefAttributes<ViewerRef>>;

export type { ViewerProps, ViewerRef };
export default Viewer;
