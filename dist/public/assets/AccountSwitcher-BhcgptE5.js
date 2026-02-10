import{c as a}from"./index-CeWB269q.js";import"./ui-vendor-CAjlhm44.js";import{a as c}from"./react-vendor-CY7EGuec.js";/**
 * @license lucide-react v0.453.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m=a("Star",[["polygon",{points:"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2",key:"8f66p6"}]]),n="current-ad-account-id",r=new Set,u=t=>(r.add(t),()=>r.delete(t)),i=t=>{r.forEach(o=>o(t))};function p(){const[t,o]=c.useState(()=>{const e=localStorage.getItem(n);return e?parseInt(e,10):null});return c.useEffect(()=>{const e=u(s=>{o(s)});return()=>{e()}},[]),t}function S(t){t?localStorage.setItem(n,t.toString()):localStorage.removeItem(n),i(t)}export{m as S,S as s,p as u};
