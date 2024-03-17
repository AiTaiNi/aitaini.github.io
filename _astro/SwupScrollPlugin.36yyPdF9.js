import{e as u}from"./index.modern.CkIAsQri.js";import{m as p}from"./Swup.CXlr5Q4E.js";function a(){return a=Object.assign?Object.assign.bind():function(n){for(var o=1;o<arguments.length;o++){var t=arguments[o];for(var s in t)Object.prototype.hasOwnProperty.call(t,s)&&(n[s]=t[s])}return n},a.apply(this,arguments)}class g{constructor(o){this._raf=null,this._positionY=0,this._velocityY=0,this._targetPositionY=0,this._targetPositionYWithOffset=0,this._direction=0,this.scrollTo=t=>{if(t&&t.nodeType)this._targetPositionY=Math.round(t.getBoundingClientRect().top+window.pageYOffset);else{if(parseInt(this._targetPositionY)!==this._targetPositionY)return void console.error("Argument must be a number or an element.");this._targetPositionY=Math.round(t)}this._targetPositionY>document.documentElement.scrollHeight-window.innerHeight&&(this._targetPositionY=document.documentElement.scrollHeight-window.innerHeight),this._positionY=document.body.scrollTop||document.documentElement.scrollTop,this._direction=this._positionY>this._targetPositionY?-1:1,this._targetPositionYWithOffset=this._targetPositionY+this._direction,this._velocityY=0,this._positionY!==this._targetPositionY?(this.options.onStart(),this._animate()):this.options.onAlreadyAtPositions()},this._animate=()=>{this._update(),this._render(),this._direction===1&&this._targetPositionY>this._positionY||this._direction===-1&&this._targetPositionY<this._positionY?(this._raf=requestAnimationFrame(this._animate),this.options.onTick()):(this._positionY=this._targetPositionY,this._render(),this._raf=null,this.options.onTick(),this.options.onEnd())},this._update=()=>{const t=this._targetPositionYWithOffset-this._positionY;return this._velocityY+=t*this.options.acceleration,this._velocityY*=this.options.friction,this._positionY+=this._velocityY,Math.abs(t)},this._render=()=>{window.scrollTo(0,this._positionY)},this.options=a({},{onAlreadyAtPositions:()=>{},onCancel:()=>{},onEnd:()=>{},onStart:()=>{},onTick:()=>{},friction:.7,acceleration:.04},o),o&&o.friction&&(this.options.friction=1-o.friction),window.addEventListener("mousewheel",t=>{this._raf&&(this.options.onCancel(),cancelAnimationFrame(this._raf),this._raf=null)},{passive:!0})}}function c(){return c=Object.assign?Object.assign.bind():function(n){for(var o=1;o<arguments.length;o++){var t=arguments[o];for(var s in t)Object.prototype.hasOwnProperty.call(t,s)&&(n[s]=t[s])}return n},c.apply(this,arguments)}class S extends u{constructor(o={}){super(),this.name="SwupScrollPlugin",this.requires={swup:">=4.2.0"},this.scrl=void 0,this.defaults={doScrollingRightAway:!1,animateScroll:{betweenPages:!0,samePageWithHash:!0,samePage:!0},scrollFriction:.3,scrollAcceleration:.04,getAnchorElement:void 0,offset:0,scrollContainers:"[data-swup-scroll-container]",shouldResetScrollPosition:()=>!0,markScrollTarget:!1},this.options=void 0,this.cachedScrollPositions={},this.previousScrollRestoration=void 0,this.currentCacheKey=void 0,this.getAnchorElement=(t="")=>typeof this.options.getAnchorElement=="function"?this.options.getAnchorElement(t):this.swup.getAnchorElement(t),this.getOffset=t=>t?typeof this.options.offset=="function"?parseInt(String(this.options.offset(t)),10):parseInt(String(this.options.offset),10):0,this.onBeforeLinkToSelf=t=>{t.scroll.animate=this.shouldAnimate("samePage")},this.handleScrollToTop=t=>{var s,i;return(s=(i=this.swup).scrollTo)==null||s.call(i,0,t.scroll.animate),!0},this.onBeforeLinkToAnchor=t=>{t.scroll.animate=this.shouldAnimate("samePageWithHash")},this.handleScrollToAnchor=(t,{hash:s})=>this.maybeScrollToAnchor(s,t.scroll.animate),this.onBeforeVisitStart=t=>{t.scroll.scrolledToContent=!1,t.scroll.animate=this.shouldAnimate("betweenPages")},this.onVisitStart=t=>{var s;this.cacheScrollPositions(t.from.url),this.maybeResetScrollPositions(t);const i=(s=t.scroll.target)!=null?s:t.to.hash;t.scroll.animate&&this.options.doScrollingRightAway&&!i&&this.doScrollingBetweenPages(t)},this.handleScrollToContent=t=>{t.scroll.scrolledToContent||this.doScrollingBetweenPages(t),this.restoreScrollContainers(t.to.url)},this.doScrollingBetweenPages=t=>{var s,i;if(t.history.popstate&&!t.animation.animate)return;const e=(s=t.scroll.target)!=null?s:t.to.hash;if(e&&this.maybeScrollToAnchor(e,t.scroll.animate)||!t.scroll.reset)return;const r=this.getCachedScrollPositions(t.to.url),l=(r==null||(i=r.window)==null?void 0:i.top)||0;requestAnimationFrame(()=>{var h,d;return(h=(d=this.swup).scrollTo)==null?void 0:h.call(d,l,t.scroll.animate)}),t.scroll.scrolledToContent=!0},this.maybeResetScrollPositions=t=>{const{popstate:s}=t.history,{url:i}=t.to,{el:e}=t.trigger;s||e&&!this.options.shouldResetScrollPosition(e)||this.resetScrollPositions(i)},this.options=c({},this.defaults,o)}mount(){const o=this.swup;o.hooks.create("scroll:start"),o.hooks.create("scroll:end");const t=this.swup.createVisit({to:this.swup.currentPageUrl});this.scrl=new g({onStart:()=>o.hooks.callSync("scroll:start",t,void 0),onEnd:()=>o.hooks.callSync("scroll:end",t,void 0),onCancel:()=>o.hooks.callSync("scroll:end",t,void 0),friction:this.options.scrollFriction,acceleration:this.options.scrollAcceleration}),o.scrollTo=(s,i=!0)=>{i?this.scrl.scrollTo(s):(o.hooks.callSync("scroll:start",t,void 0),window.scrollTo(0,s),o.hooks.callSync("scroll:end",t,void 0))},this.previousScrollRestoration=window.history.scrollRestoration,o.options.animateHistoryBrowsing&&(window.history.scrollRestoration="manual"),this.updateScrollTarget=this.updateScrollTarget.bind(this),this.options.markScrollTarget&&(window.addEventListener("popstate",this.updateScrollTarget),window.addEventListener("hashchange",this.updateScrollTarget),this.on("page:view",this.updateScrollTarget),this.on("link:anchor",this.updateScrollTarget),this.on("link:self",this.updateScrollTarget),this.updateScrollTarget()),this.before("visit:start",this.onBeforeVisitStart,{priority:-1}),this.on("visit:start",this.onVisitStart,{priority:1}),this.replace("content:scroll",this.handleScrollToContent),this.before("link:self",this.onBeforeLinkToSelf,{priority:-1}),this.replace("scroll:top",this.handleScrollToTop),this.before("link:anchor",this.onBeforeLinkToAnchor,{priority:-1}),this.replace("scroll:anchor",this.handleScrollToAnchor)}unmount(){super.unmount(),this.previousScrollRestoration&&(window.history.scrollRestoration=this.previousScrollRestoration),window.removeEventListener("popstate",this.updateScrollTarget),window.removeEventListener("hashchange",this.updateScrollTarget),this.cachedScrollPositions={},delete this.swup.scrollTo,delete this.scrl}shouldAnimate(o){return typeof this.options.animateScroll=="boolean"?this.options.animateScroll:this.options.animateScroll[o]}maybeScrollToAnchor(o,t=!1){var s,i;if(!o)return!1;const e=this.getAnchorElement(o);if(!e)return console.warn(`Anchor target ${o} not found`),!1;if(!(e instanceof Element))return console.warn(`Anchor target ${o} is not a DOM node`),!1;const{top:r}=e.getBoundingClientRect(),l=r+window.scrollY-this.getOffset(e);return(s=(i=this.swup).scrollTo)==null||s.call(i,l,t),!0}cacheScrollPositions(o){const t=this.swup.resolveUrl(o),s=p(this.options.scrollContainers).map(e=>({top:e.scrollTop,left:e.scrollLeft})),i={window:{top:window.scrollY,left:window.scrollX},containers:s};this.cachedScrollPositions[t]=i}resetScrollPositions(o){const t=this.swup.resolveUrl(o);delete this.cachedScrollPositions[t]}getCachedScrollPositions(o){const t=this.swup.resolveUrl(o);return this.cachedScrollPositions[t]}restoreScrollContainers(o){const t=this.getCachedScrollPositions(o);t&&t.containers.length!==0&&p(this.options.scrollContainers).forEach((s,i)=>{const e=t.containers[i];e!=null&&(s.scrollTop=e.top,s.scrollLeft=e.left)})}updateScrollTarget(){var o;const{hash:t}=window.location,s=document.querySelector("[data-swup-scroll-target]");let i=this.getAnchorElement(t);i instanceof HTMLBodyElement&&(i=null),s!==i&&(s?.removeAttribute("data-swup-scroll-target"),(o=i)==null||o.setAttribute("data-swup-scroll-target",""))}}export{S as default};
