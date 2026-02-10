import{_ as l,g as Ve,s as Oe,t as Pe,q as Ne,a as Re,b as Be,c as ut,d as bt,e as He,at as U,l as Et,k as qe,j as Ge,z as Xe,u as je}from"./mermaid.core-DvBsp2fP.js";import{g as Gt}from"./react-vendor-CY7EGuec.js";import{b$ as pe,c0 as Ue,c1 as ge,c2 as ve,c3 as be,c4 as Lt,c5 as Ze,c6 as $e,c7 as Qe,c8 as Ke,bb as Je,c9 as ie,ca as ne,cb as tr,cc as er,cd as rr,ce as ir,cf as nr,cg as ar,ch as sr,ci as ae,cj as se,ck as oe,cl as ce,cm as le}from"./index-CeWB269q.js";import"./CampaignDetail-CP9--1kQ.js";import"./ui-vendor-CAjlhm44.js";import"./tabs-BXADeEWi.js";import"./table-DkBpihbd.js";import"./index-BAh3pvl3.js";import"./input-DuplAkCm.js";import"./label-gqoORa9J.js";import"./select-BvGv7JgL.js";import"./chevron-up-VhTKtPBj.js";import"./checkbox-DkL0Gbgm.js";import"./mouse-pointer-C9O4QAnY.js";import"./LineChart-DfpYufBh.js";import"./Line-DT7ckcxr.js";import"./minus-CCj41GdS.js";import"./slider-BHyTvaf-.js";import"./alert-B1FAxW3F.js";import"./ComposedChart-BvOXUzwo.js";import"./info-BH3pz1A6.js";import"./monitor-DYuI3LlG.js";import"./arrow-left-DJbSicFB.js";import"./play-DkEuTcYM.js";import"./eye-BpL-5rDu.js";import"./mouse-pointer-click-D2G1sc9K.js";import"./layers-BlM1Zv7G.js";import"./pause-BO4wCJzl.js";import"./pen-C_9lEIlm.js";import"./tag-uOganXI4.js";import"./plus-CGnc3B_j.js";import"./ellipsis-BTgbdN7m.js";import"./ban-C4VZ3s0_.js";const or=Math.PI/180,cr=180/Math.PI,Mt=18,xe=.96422,Te=1,we=.82521,_e=4/29,dt=6/29,De=3*dt*dt,lr=dt*dt*dt;function Ce(t){if(t instanceof et)return new et(t.l,t.a,t.b,t.opacity);if(t instanceof it)return Se(t);t instanceof pe||(t=Ue(t));var e=Vt(t.r),r=Vt(t.g),i=Vt(t.b),a=Yt((.2225045*e+.7168786*r+.0606169*i)/Te),h,u;return e===r&&r===i?h=u=a:(h=Yt((.4360747*e+.3850649*r+.1430804*i)/xe),u=Yt((.0139322*e+.0971045*r+.7141733*i)/we)),new et(116*a-16,500*(h-a),200*(a-u),t.opacity)}function ur(t,e,r,i){return arguments.length===1?Ce(t):new et(t,e,r,i??1)}function et(t,e,r,i){this.l=+t,this.a=+e,this.b=+r,this.opacity=+i}ge(et,ur,ve(be,{brighter(t){return new et(this.l+Mt*(t??1),this.a,this.b,this.opacity)},darker(t){return new et(this.l-Mt*(t??1),this.a,this.b,this.opacity)},rgb(){var t=(this.l+16)/116,e=isNaN(this.a)?t:t+this.a/500,r=isNaN(this.b)?t:t-this.b/200;return e=xe*Wt(e),t=Te*Wt(t),r=we*Wt(r),new pe(zt(3.1338561*e-1.6168667*t-.4906146*r),zt(-.9787684*e+1.9161415*t+.033454*r),zt(.0719453*e-.2289914*t+1.4052427*r),this.opacity)}}));function Yt(t){return t>lr?Math.pow(t,1/3):t/De+_e}function Wt(t){return t>dt?t*t*t:De*(t-_e)}function zt(t){return 255*(t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055)}function Vt(t){return(t/=255)<=.04045?t/12.92:Math.pow((t+.055)/1.055,2.4)}function dr(t){if(t instanceof it)return new it(t.h,t.c,t.l,t.opacity);if(t instanceof et||(t=Ce(t)),t.a===0&&t.b===0)return new it(NaN,0<t.l&&t.l<100?0:NaN,t.l,t.opacity);var e=Math.atan2(t.b,t.a)*cr;return new it(e<0?e+360:e,Math.sqrt(t.a*t.a+t.b*t.b),t.l,t.opacity)}function Pt(t,e,r,i){return arguments.length===1?dr(t):new it(t,e,r,i??1)}function it(t,e,r,i){this.h=+t,this.c=+e,this.l=+r,this.opacity=+i}function Se(t){if(isNaN(t.h))return new et(t.l,0,0,t.opacity);var e=t.h*or;return new et(t.l,Math.cos(e)*t.c,Math.sin(e)*t.c,t.opacity)}ge(it,Pt,ve(be,{brighter(t){return new it(this.h,this.c,this.l+Mt*(t??1),this.opacity)},darker(t){return new it(this.h,this.c,this.l-Mt*(t??1),this.opacity)},rgb(){return Se(this).rgb()}}));function fr(t){return function(e,r){var i=t((e=Pt(e)).h,(r=Pt(r)).h),a=Lt(e.c,r.c),h=Lt(e.l,r.l),u=Lt(e.opacity,r.opacity);return function(w){return e.h=i(w),e.c=a(w),e.l=h(w),e.opacity=u(w),e+""}}}const hr=fr(Ze);function mr(t){return t}var Tt=1,Ot=2,Nt=3,xt=4,ue=1e-6;function kr(t){return"translate("+t+",0)"}function yr(t){return"translate(0,"+t+")"}function pr(t){return e=>+t(e)}function gr(t,e){return e=Math.max(0,t.bandwidth()-e*2)/2,t.round()&&(e=Math.round(e)),r=>+t(r)+e}function vr(){return!this.__axis}function Ee(t,e){var r=[],i=null,a=null,h=6,u=6,w=3,E=typeof window<"u"&&window.devicePixelRatio>1?0:.5,S=t===Tt||t===xt?-1:1,g=t===xt||t===Ot?"x":"y",F=t===Tt||t===Nt?kr:yr;function C(b){var q=i??(e.ticks?e.ticks.apply(e,r):e.domain()),A=a??(e.tickFormat?e.tickFormat.apply(e,r):mr),x=Math.max(h,0)+w,M=e.range(),L=+M[0]+E,Y=+M[M.length-1]+E,R=(e.bandwidth?gr:pr)(e.copy(),E),N=b.selection?b.selection():b,G=N.selectAll(".domain").data([null]),O=N.selectAll(".tick").data(q,e).order(),p=O.exit(),_=O.enter().append("g").attr("class","tick"),T=O.select("line"),v=O.select("text");G=G.merge(G.enter().insert("path",".tick").attr("class","domain").attr("stroke","currentColor")),O=O.merge(_),T=T.merge(_.append("line").attr("stroke","currentColor").attr(g+"2",S*h)),v=v.merge(_.append("text").attr("fill","currentColor").attr(g,S*x).attr("dy",t===Tt?"0em":t===Nt?"0.71em":"0.32em")),b!==N&&(G=G.transition(b),O=O.transition(b),T=T.transition(b),v=v.transition(b),p=p.transition(b).attr("opacity",ue).attr("transform",function(m){return isFinite(m=R(m))?F(m+E):this.getAttribute("transform")}),_.attr("opacity",ue).attr("transform",function(m){var D=this.parentNode.__axis;return F((D&&isFinite(D=D(m))?D:R(m))+E)})),p.remove(),G.attr("d",t===xt||t===Ot?u?"M"+S*u+","+L+"H"+E+"V"+Y+"H"+S*u:"M"+E+","+L+"V"+Y:u?"M"+L+","+S*u+"V"+E+"H"+Y+"V"+S*u:"M"+L+","+E+"H"+Y),O.attr("opacity",1).attr("transform",function(m){return F(R(m)+E)}),T.attr(g+"2",S*h),v.attr(g,S*x).text(A),N.filter(vr).attr("fill","none").attr("font-size",10).attr("font-family","sans-serif").attr("text-anchor",t===Ot?"start":t===xt?"end":"middle"),N.each(function(){this.__axis=R})}return C.scale=function(b){return arguments.length?(e=b,C):e},C.ticks=function(){return r=Array.from(arguments),C},C.tickArguments=function(b){return arguments.length?(r=b==null?[]:Array.from(b),C):r.slice()},C.tickValues=function(b){return arguments.length?(i=b==null?null:Array.from(b),C):i&&i.slice()},C.tickFormat=function(b){return arguments.length?(a=b,C):a},C.tickSize=function(b){return arguments.length?(h=u=+b,C):h},C.tickSizeInner=function(b){return arguments.length?(h=+b,C):h},C.tickSizeOuter=function(b){return arguments.length?(u=+b,C):u},C.tickPadding=function(b){return arguments.length?(w=+b,C):w},C.offset=function(b){return arguments.length?(E=+b,C):E},C}function br(t){return Ee(Tt,t)}function xr(t){return Ee(Nt,t)}var wt={exports:{}},Tr=wt.exports,de;function wr(){return de||(de=1,(function(t,e){(function(r,i){t.exports=i()})(Tr,(function(){var r="day";return function(i,a,h){var u=function(S){return S.add(4-S.isoWeekday(),r)},w=a.prototype;w.isoWeekYear=function(){return u(this).year()},w.isoWeek=function(S){if(!this.$utils().u(S))return this.add(7*(S-this.isoWeek()),r);var g,F,C,b,q=u(this),A=(g=this.isoWeekYear(),F=this.$u,C=(F?h.utc:h)().year(g).startOf("year"),b=4-C.isoWeekday(),C.isoWeekday()>4&&(b+=7),C.add(b,r));return q.diff(A,"week")+1},w.isoWeekday=function(S){return this.$utils().u(S)?this.day()||7:this.day(this.day()%7?S:S-7)};var E=w.startOf;w.startOf=function(S,g){var F=this.$utils(),C=!!F.u(g)||g;return F.p(S)==="isoweek"?C?this.date(this.date()-(this.isoWeekday()-1)).startOf("day"):this.date(this.date()-1-(this.isoWeekday()-1)+7).endOf("day"):E.bind(this)(S,g)}}}))})(wt)),wt.exports}var _r=wr();const Dr=Gt(_r);var _t={exports:{}},Cr=_t.exports,fe;function Sr(){return fe||(fe=1,(function(t,e){(function(r,i){t.exports=i()})(Cr,(function(){var r={LTS:"h:mm:ss A",LT:"h:mm A",L:"MM/DD/YYYY",LL:"MMMM D, YYYY",LLL:"MMMM D, YYYY h:mm A",LLLL:"dddd, MMMM D, YYYY h:mm A"},i=/(\[[^[]*\])|([-_:/.,()\s]+)|(A|a|Q|YYYY|YY?|ww?|MM?M?M?|Do|DD?|hh?|HH?|mm?|ss?|S{1,3}|z|ZZ?)/g,a=/\d/,h=/\d\d/,u=/\d\d?/,w=/\d*[^-_:/,()\s\d]+/,E={},S=function(x){return(x=+x)+(x>68?1900:2e3)},g=function(x){return function(M){this[x]=+M}},F=[/[+-]\d\d:?(\d\d)?|Z/,function(x){(this.zone||(this.zone={})).offset=(function(M){if(!M||M==="Z")return 0;var L=M.match(/([+-]|\d\d)/g),Y=60*L[1]+(+L[2]||0);return Y===0?0:L[0]==="+"?-Y:Y})(x)}],C=function(x){var M=E[x];return M&&(M.indexOf?M:M.s.concat(M.f))},b=function(x,M){var L,Y=E.meridiem;if(Y){for(var R=1;R<=24;R+=1)if(x.indexOf(Y(R,0,M))>-1){L=R>12;break}}else L=x===(M?"pm":"PM");return L},q={A:[w,function(x){this.afternoon=b(x,!1)}],a:[w,function(x){this.afternoon=b(x,!0)}],Q:[a,function(x){this.month=3*(x-1)+1}],S:[a,function(x){this.milliseconds=100*+x}],SS:[h,function(x){this.milliseconds=10*+x}],SSS:[/\d{3}/,function(x){this.milliseconds=+x}],s:[u,g("seconds")],ss:[u,g("seconds")],m:[u,g("minutes")],mm:[u,g("minutes")],H:[u,g("hours")],h:[u,g("hours")],HH:[u,g("hours")],hh:[u,g("hours")],D:[u,g("day")],DD:[h,g("day")],Do:[w,function(x){var M=E.ordinal,L=x.match(/\d+/);if(this.day=L[0],M)for(var Y=1;Y<=31;Y+=1)M(Y).replace(/\[|\]/g,"")===x&&(this.day=Y)}],w:[u,g("week")],ww:[h,g("week")],M:[u,g("month")],MM:[h,g("month")],MMM:[w,function(x){var M=C("months"),L=(C("monthsShort")||M.map((function(Y){return Y.slice(0,3)}))).indexOf(x)+1;if(L<1)throw new Error;this.month=L%12||L}],MMMM:[w,function(x){var M=C("months").indexOf(x)+1;if(M<1)throw new Error;this.month=M%12||M}],Y:[/[+-]?\d+/,g("year")],YY:[h,function(x){this.year=S(x)}],YYYY:[/\d{4}/,g("year")],Z:F,ZZ:F};function A(x){var M,L;M=x,L=E&&E.formats;for(var Y=(x=M.replace(/(\[[^\]]+])|(LTS?|l{1,4}|L{1,4})/g,(function(T,v,m){var D=m&&m.toUpperCase();return v||L[m]||r[m]||L[D].replace(/(\[[^\]]+])|(MMMM|MM|DD|dddd)/g,(function(c,f,k){return f||k.slice(1)}))}))).match(i),R=Y.length,N=0;N<R;N+=1){var G=Y[N],O=q[G],p=O&&O[0],_=O&&O[1];Y[N]=_?{regex:p,parser:_}:G.replace(/^\[|\]$/g,"")}return function(T){for(var v={},m=0,D=0;m<R;m+=1){var c=Y[m];if(typeof c=="string")D+=c.length;else{var f=c.regex,k=c.parser,d=T.slice(D),y=f.exec(d)[0];k.call(v,y),T=T.replace(y,"")}}return(function(s){var o=s.afternoon;if(o!==void 0){var n=s.hours;o?n<12&&(s.hours+=12):n===12&&(s.hours=0),delete s.afternoon}})(v),v}}return function(x,M,L){L.p.customParseFormat=!0,x&&x.parseTwoDigitYear&&(S=x.parseTwoDigitYear);var Y=M.prototype,R=Y.parse;Y.parse=function(N){var G=N.date,O=N.utc,p=N.args;this.$u=O;var _=p[1];if(typeof _=="string"){var T=p[2]===!0,v=p[3]===!0,m=T||v,D=p[2];v&&(D=p[2]),E=this.$locale(),!T&&D&&(E=L.Ls[D]),this.$d=(function(d,y,s,o){try{if(["x","X"].indexOf(y)>-1)return new Date((y==="X"?1e3:1)*d);var n=A(y)(d),W=n.year,I=n.month,z=n.day,X=n.hours,V=n.minutes,P=n.seconds,Q=n.milliseconds,ot=n.zone,ct=n.week,mt=new Date,kt=z||(W||I?1:mt.getDate()),lt=W||mt.getFullYear(),B=0;W&&!I||(B=I>0?I-1:mt.getMonth());var $,j=X||0,at=V||0,K=P||0,nt=Q||0;return ot?new Date(Date.UTC(lt,B,kt,j,at,K,nt+60*ot.offset*1e3)):s?new Date(Date.UTC(lt,B,kt,j,at,K,nt)):($=new Date(lt,B,kt,j,at,K,nt),ct&&($=o($).week(ct).toDate()),$)}catch{return new Date("")}})(G,_,O,L),this.init(),D&&D!==!0&&(this.$L=this.locale(D).$L),m&&G!=this.format(_)&&(this.$d=new Date("")),E={}}else if(_ instanceof Array)for(var c=_.length,f=1;f<=c;f+=1){p[1]=_[f-1];var k=L.apply(this,p);if(k.isValid()){this.$d=k.$d,this.$L=k.$L,this.init();break}f===c&&(this.$d=new Date(""))}else R.call(this,N)}}}))})(_t)),_t.exports}var Er=Sr();const Mr=Gt(Er);var Dt={exports:{}},Ar=Dt.exports,he;function Ir(){return he||(he=1,(function(t,e){(function(r,i){t.exports=i()})(Ar,(function(){return function(r,i){var a=i.prototype,h=a.format;a.format=function(u){var w=this,E=this.$locale();if(!this.isValid())return h.bind(this)(u);var S=this.$utils(),g=(u||"YYYY-MM-DDTHH:mm:ssZ").replace(/\[([^\]]+)]|Q|wo|ww|w|WW|W|zzz|z|gggg|GGGG|Do|X|x|k{1,2}|S/g,(function(F){switch(F){case"Q":return Math.ceil((w.$M+1)/3);case"Do":return E.ordinal(w.$D);case"gggg":return w.weekYear();case"GGGG":return w.isoWeekYear();case"wo":return E.ordinal(w.week(),"W");case"w":case"ww":return S.s(w.week(),F==="w"?1:2,"0");case"W":case"WW":return S.s(w.isoWeek(),F==="W"?1:2,"0");case"k":case"kk":return S.s(String(w.$H===0?24:w.$H),F==="k"?1:2,"0");case"X":return Math.floor(w.$d.getTime()/1e3);case"x":return w.$d.getTime();case"z":return"["+w.offsetName()+"]";case"zzz":return"["+w.offsetName("long")+"]";default:return F}}));return h.bind(this)(g)}}}))})(Dt)),Dt.exports}var Fr=Ir();const Lr=Gt(Fr);var Rt=(function(){var t=l(function(D,c,f,k){for(f=f||{},k=D.length;k--;f[D[k]]=c);return f},"o"),e=[6,8,10,12,13,14,15,16,17,18,20,21,22,23,24,25,26,27,28,29,30,31,33,35,36,38,40],r=[1,26],i=[1,27],a=[1,28],h=[1,29],u=[1,30],w=[1,31],E=[1,32],S=[1,33],g=[1,34],F=[1,9],C=[1,10],b=[1,11],q=[1,12],A=[1,13],x=[1,14],M=[1,15],L=[1,16],Y=[1,19],R=[1,20],N=[1,21],G=[1,22],O=[1,23],p=[1,25],_=[1,35],T={trace:l(function(){},"trace"),yy:{},symbols_:{error:2,start:3,gantt:4,document:5,EOF:6,line:7,SPACE:8,statement:9,NL:10,weekday:11,weekday_monday:12,weekday_tuesday:13,weekday_wednesday:14,weekday_thursday:15,weekday_friday:16,weekday_saturday:17,weekday_sunday:18,weekend:19,weekend_friday:20,weekend_saturday:21,dateFormat:22,inclusiveEndDates:23,topAxis:24,axisFormat:25,tickInterval:26,excludes:27,includes:28,todayMarker:29,title:30,acc_title:31,acc_title_value:32,acc_descr:33,acc_descr_value:34,acc_descr_multiline_value:35,section:36,clickStatement:37,taskTxt:38,taskData:39,click:40,callbackname:41,callbackargs:42,href:43,clickStatementDebug:44,$accept:0,$end:1},terminals_:{2:"error",4:"gantt",6:"EOF",8:"SPACE",10:"NL",12:"weekday_monday",13:"weekday_tuesday",14:"weekday_wednesday",15:"weekday_thursday",16:"weekday_friday",17:"weekday_saturday",18:"weekday_sunday",20:"weekend_friday",21:"weekend_saturday",22:"dateFormat",23:"inclusiveEndDates",24:"topAxis",25:"axisFormat",26:"tickInterval",27:"excludes",28:"includes",29:"todayMarker",30:"title",31:"acc_title",32:"acc_title_value",33:"acc_descr",34:"acc_descr_value",35:"acc_descr_multiline_value",36:"section",38:"taskTxt",39:"taskData",40:"click",41:"callbackname",42:"callbackargs",43:"href"},productions_:[0,[3,3],[5,0],[5,2],[7,2],[7,1],[7,1],[7,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[19,1],[19,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,2],[9,2],[9,1],[9,1],[9,1],[9,2],[37,2],[37,3],[37,3],[37,4],[37,3],[37,4],[37,2],[44,2],[44,3],[44,3],[44,4],[44,3],[44,4],[44,2]],performAction:l(function(c,f,k,d,y,s,o){var n=s.length-1;switch(y){case 1:return s[n-1];case 2:this.$=[];break;case 3:s[n-1].push(s[n]),this.$=s[n-1];break;case 4:case 5:this.$=s[n];break;case 6:case 7:this.$=[];break;case 8:d.setWeekday("monday");break;case 9:d.setWeekday("tuesday");break;case 10:d.setWeekday("wednesday");break;case 11:d.setWeekday("thursday");break;case 12:d.setWeekday("friday");break;case 13:d.setWeekday("saturday");break;case 14:d.setWeekday("sunday");break;case 15:d.setWeekend("friday");break;case 16:d.setWeekend("saturday");break;case 17:d.setDateFormat(s[n].substr(11)),this.$=s[n].substr(11);break;case 18:d.enableInclusiveEndDates(),this.$=s[n].substr(18);break;case 19:d.TopAxis(),this.$=s[n].substr(8);break;case 20:d.setAxisFormat(s[n].substr(11)),this.$=s[n].substr(11);break;case 21:d.setTickInterval(s[n].substr(13)),this.$=s[n].substr(13);break;case 22:d.setExcludes(s[n].substr(9)),this.$=s[n].substr(9);break;case 23:d.setIncludes(s[n].substr(9)),this.$=s[n].substr(9);break;case 24:d.setTodayMarker(s[n].substr(12)),this.$=s[n].substr(12);break;case 27:d.setDiagramTitle(s[n].substr(6)),this.$=s[n].substr(6);break;case 28:this.$=s[n].trim(),d.setAccTitle(this.$);break;case 29:case 30:this.$=s[n].trim(),d.setAccDescription(this.$);break;case 31:d.addSection(s[n].substr(8)),this.$=s[n].substr(8);break;case 33:d.addTask(s[n-1],s[n]),this.$="task";break;case 34:this.$=s[n-1],d.setClickEvent(s[n-1],s[n],null);break;case 35:this.$=s[n-2],d.setClickEvent(s[n-2],s[n-1],s[n]);break;case 36:this.$=s[n-2],d.setClickEvent(s[n-2],s[n-1],null),d.setLink(s[n-2],s[n]);break;case 37:this.$=s[n-3],d.setClickEvent(s[n-3],s[n-2],s[n-1]),d.setLink(s[n-3],s[n]);break;case 38:this.$=s[n-2],d.setClickEvent(s[n-2],s[n],null),d.setLink(s[n-2],s[n-1]);break;case 39:this.$=s[n-3],d.setClickEvent(s[n-3],s[n-1],s[n]),d.setLink(s[n-3],s[n-2]);break;case 40:this.$=s[n-1],d.setLink(s[n-1],s[n]);break;case 41:case 47:this.$=s[n-1]+" "+s[n];break;case 42:case 43:case 45:this.$=s[n-2]+" "+s[n-1]+" "+s[n];break;case 44:case 46:this.$=s[n-3]+" "+s[n-2]+" "+s[n-1]+" "+s[n];break}},"anonymous"),table:[{3:1,4:[1,2]},{1:[3]},t(e,[2,2],{5:3}),{6:[1,4],7:5,8:[1,6],9:7,10:[1,8],11:17,12:r,13:i,14:a,15:h,16:u,17:w,18:E,19:18,20:S,21:g,22:F,23:C,24:b,25:q,26:A,27:x,28:M,29:L,30:Y,31:R,33:N,35:G,36:O,37:24,38:p,40:_},t(e,[2,7],{1:[2,1]}),t(e,[2,3]),{9:36,11:17,12:r,13:i,14:a,15:h,16:u,17:w,18:E,19:18,20:S,21:g,22:F,23:C,24:b,25:q,26:A,27:x,28:M,29:L,30:Y,31:R,33:N,35:G,36:O,37:24,38:p,40:_},t(e,[2,5]),t(e,[2,6]),t(e,[2,17]),t(e,[2,18]),t(e,[2,19]),t(e,[2,20]),t(e,[2,21]),t(e,[2,22]),t(e,[2,23]),t(e,[2,24]),t(e,[2,25]),t(e,[2,26]),t(e,[2,27]),{32:[1,37]},{34:[1,38]},t(e,[2,30]),t(e,[2,31]),t(e,[2,32]),{39:[1,39]},t(e,[2,8]),t(e,[2,9]),t(e,[2,10]),t(e,[2,11]),t(e,[2,12]),t(e,[2,13]),t(e,[2,14]),t(e,[2,15]),t(e,[2,16]),{41:[1,40],43:[1,41]},t(e,[2,4]),t(e,[2,28]),t(e,[2,29]),t(e,[2,33]),t(e,[2,34],{42:[1,42],43:[1,43]}),t(e,[2,40],{41:[1,44]}),t(e,[2,35],{43:[1,45]}),t(e,[2,36]),t(e,[2,38],{42:[1,46]}),t(e,[2,37]),t(e,[2,39])],defaultActions:{},parseError:l(function(c,f){if(f.recoverable)this.trace(c);else{var k=new Error(c);throw k.hash=f,k}},"parseError"),parse:l(function(c){var f=this,k=[0],d=[],y=[null],s=[],o=this.table,n="",W=0,I=0,z=2,X=1,V=s.slice.call(arguments,1),P=Object.create(this.lexer),Q={yy:{}};for(var ot in this.yy)Object.prototype.hasOwnProperty.call(this.yy,ot)&&(Q.yy[ot]=this.yy[ot]);P.setInput(c,Q.yy),Q.yy.lexer=P,Q.yy.parser=this,typeof P.yylloc>"u"&&(P.yylloc={});var ct=P.yylloc;s.push(ct);var mt=P.options&&P.options.ranges;typeof Q.yy.parseError=="function"?this.parseError=Q.yy.parseError:this.parseError=Object.getPrototypeOf(this).parseError;function kt(Z){k.length=k.length-2*Z,y.length=y.length-Z,s.length=s.length-Z}l(kt,"popStack");function lt(){var Z;return Z=d.pop()||P.lex()||X,typeof Z!="number"&&(Z instanceof Array&&(d=Z,Z=d.pop()),Z=f.symbols_[Z]||Z),Z}l(lt,"lex");for(var B,$,j,at,K={},nt,J,re,vt;;){if($=k[k.length-1],this.defaultActions[$]?j=this.defaultActions[$]:((B===null||typeof B>"u")&&(B=lt()),j=o[$]&&o[$][B]),typeof j>"u"||!j.length||!j[0]){var Ft="";vt=[];for(nt in o[$])this.terminals_[nt]&&nt>z&&vt.push("'"+this.terminals_[nt]+"'");P.showPosition?Ft="Parse error on line "+(W+1)+`:
`+P.showPosition()+`
Expecting `+vt.join(", ")+", got '"+(this.terminals_[B]||B)+"'":Ft="Parse error on line "+(W+1)+": Unexpected "+(B==X?"end of input":"'"+(this.terminals_[B]||B)+"'"),this.parseError(Ft,{text:P.match,token:this.terminals_[B]||B,line:P.yylineno,loc:ct,expected:vt})}if(j[0]instanceof Array&&j.length>1)throw new Error("Parse Error: multiple actions possible at state: "+$+", token: "+B);switch(j[0]){case 1:k.push(B),y.push(P.yytext),s.push(P.yylloc),k.push(j[1]),B=null,I=P.yyleng,n=P.yytext,W=P.yylineno,ct=P.yylloc;break;case 2:if(J=this.productions_[j[1]][1],K.$=y[y.length-J],K._$={first_line:s[s.length-(J||1)].first_line,last_line:s[s.length-1].last_line,first_column:s[s.length-(J||1)].first_column,last_column:s[s.length-1].last_column},mt&&(K._$.range=[s[s.length-(J||1)].range[0],s[s.length-1].range[1]]),at=this.performAction.apply(K,[n,I,W,Q.yy,j[1],y,s].concat(V)),typeof at<"u")return at;J&&(k=k.slice(0,-1*J*2),y=y.slice(0,-1*J),s=s.slice(0,-1*J)),k.push(this.productions_[j[1]][0]),y.push(K.$),s.push(K._$),re=o[k[k.length-2]][k[k.length-1]],k.push(re);break;case 3:return!0}}return!0},"parse")},v=(function(){var D={EOF:1,parseError:l(function(f,k){if(this.yy.parser)this.yy.parser.parseError(f,k);else throw new Error(f)},"parseError"),setInput:l(function(c,f){return this.yy=f||this.yy||{},this._input=c,this._more=this._backtrack=this.done=!1,this.yylineno=this.yyleng=0,this.yytext=this.matched=this.match="",this.conditionStack=["INITIAL"],this.yylloc={first_line:1,first_column:0,last_line:1,last_column:0},this.options.ranges&&(this.yylloc.range=[0,0]),this.offset=0,this},"setInput"),input:l(function(){var c=this._input[0];this.yytext+=c,this.yyleng++,this.offset++,this.match+=c,this.matched+=c;var f=c.match(/(?:\r\n?|\n).*/g);return f?(this.yylineno++,this.yylloc.last_line++):this.yylloc.last_column++,this.options.ranges&&this.yylloc.range[1]++,this._input=this._input.slice(1),c},"input"),unput:l(function(c){var f=c.length,k=c.split(/(?:\r\n?|\n)/g);this._input=c+this._input,this.yytext=this.yytext.substr(0,this.yytext.length-f),this.offset-=f;var d=this.match.split(/(?:\r\n?|\n)/g);this.match=this.match.substr(0,this.match.length-1),this.matched=this.matched.substr(0,this.matched.length-1),k.length-1&&(this.yylineno-=k.length-1);var y=this.yylloc.range;return this.yylloc={first_line:this.yylloc.first_line,last_line:this.yylineno+1,first_column:this.yylloc.first_column,last_column:k?(k.length===d.length?this.yylloc.first_column:0)+d[d.length-k.length].length-k[0].length:this.yylloc.first_column-f},this.options.ranges&&(this.yylloc.range=[y[0],y[0]+this.yyleng-f]),this.yyleng=this.yytext.length,this},"unput"),more:l(function(){return this._more=!0,this},"more"),reject:l(function(){if(this.options.backtrack_lexer)this._backtrack=!0;else return this.parseError("Lexical error on line "+(this.yylineno+1)+`. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
`+this.showPosition(),{text:"",token:null,line:this.yylineno});return this},"reject"),less:l(function(c){this.unput(this.match.slice(c))},"less"),pastInput:l(function(){var c=this.matched.substr(0,this.matched.length-this.match.length);return(c.length>20?"...":"")+c.substr(-20).replace(/\n/g,"")},"pastInput"),upcomingInput:l(function(){var c=this.match;return c.length<20&&(c+=this._input.substr(0,20-c.length)),(c.substr(0,20)+(c.length>20?"...":"")).replace(/\n/g,"")},"upcomingInput"),showPosition:l(function(){var c=this.pastInput(),f=new Array(c.length+1).join("-");return c+this.upcomingInput()+`
`+f+"^"},"showPosition"),test_match:l(function(c,f){var k,d,y;if(this.options.backtrack_lexer&&(y={yylineno:this.yylineno,yylloc:{first_line:this.yylloc.first_line,last_line:this.last_line,first_column:this.yylloc.first_column,last_column:this.yylloc.last_column},yytext:this.yytext,match:this.match,matches:this.matches,matched:this.matched,yyleng:this.yyleng,offset:this.offset,_more:this._more,_input:this._input,yy:this.yy,conditionStack:this.conditionStack.slice(0),done:this.done},this.options.ranges&&(y.yylloc.range=this.yylloc.range.slice(0))),d=c[0].match(/(?:\r\n?|\n).*/g),d&&(this.yylineno+=d.length),this.yylloc={first_line:this.yylloc.last_line,last_line:this.yylineno+1,first_column:this.yylloc.last_column,last_column:d?d[d.length-1].length-d[d.length-1].match(/\r?\n?/)[0].length:this.yylloc.last_column+c[0].length},this.yytext+=c[0],this.match+=c[0],this.matches=c,this.yyleng=this.yytext.length,this.options.ranges&&(this.yylloc.range=[this.offset,this.offset+=this.yyleng]),this._more=!1,this._backtrack=!1,this._input=this._input.slice(c[0].length),this.matched+=c[0],k=this.performAction.call(this,this.yy,this,f,this.conditionStack[this.conditionStack.length-1]),this.done&&this._input&&(this.done=!1),k)return k;if(this._backtrack){for(var s in y)this[s]=y[s];return!1}return!1},"test_match"),next:l(function(){if(this.done)return this.EOF;this._input||(this.done=!0);var c,f,k,d;this._more||(this.yytext="",this.match="");for(var y=this._currentRules(),s=0;s<y.length;s++)if(k=this._input.match(this.rules[y[s]]),k&&(!f||k[0].length>f[0].length)){if(f=k,d=s,this.options.backtrack_lexer){if(c=this.test_match(k,y[s]),c!==!1)return c;if(this._backtrack){f=!1;continue}else return!1}else if(!this.options.flex)break}return f?(c=this.test_match(f,y[d]),c!==!1?c:!1):this._input===""?this.EOF:this.parseError("Lexical error on line "+(this.yylineno+1)+`. Unrecognized text.
`+this.showPosition(),{text:"",token:null,line:this.yylineno})},"next"),lex:l(function(){var f=this.next();return f||this.lex()},"lex"),begin:l(function(f){this.conditionStack.push(f)},"begin"),popState:l(function(){var f=this.conditionStack.length-1;return f>0?this.conditionStack.pop():this.conditionStack[0]},"popState"),_currentRules:l(function(){return this.conditionStack.length&&this.conditionStack[this.conditionStack.length-1]?this.conditions[this.conditionStack[this.conditionStack.length-1]].rules:this.conditions.INITIAL.rules},"_currentRules"),topState:l(function(f){return f=this.conditionStack.length-1-Math.abs(f||0),f>=0?this.conditionStack[f]:"INITIAL"},"topState"),pushState:l(function(f){this.begin(f)},"pushState"),stateStackSize:l(function(){return this.conditionStack.length},"stateStackSize"),options:{"case-insensitive":!0},performAction:l(function(f,k,d,y){switch(d){case 0:return this.begin("open_directive"),"open_directive";case 1:return this.begin("acc_title"),31;case 2:return this.popState(),"acc_title_value";case 3:return this.begin("acc_descr"),33;case 4:return this.popState(),"acc_descr_value";case 5:this.begin("acc_descr_multiline");break;case 6:this.popState();break;case 7:return"acc_descr_multiline_value";case 8:break;case 9:break;case 10:break;case 11:return 10;case 12:break;case 13:break;case 14:this.begin("href");break;case 15:this.popState();break;case 16:return 43;case 17:this.begin("callbackname");break;case 18:this.popState();break;case 19:this.popState(),this.begin("callbackargs");break;case 20:return 41;case 21:this.popState();break;case 22:return 42;case 23:this.begin("click");break;case 24:this.popState();break;case 25:return 40;case 26:return 4;case 27:return 22;case 28:return 23;case 29:return 24;case 30:return 25;case 31:return 26;case 32:return 28;case 33:return 27;case 34:return 29;case 35:return 12;case 36:return 13;case 37:return 14;case 38:return 15;case 39:return 16;case 40:return 17;case 41:return 18;case 42:return 20;case 43:return 21;case 44:return"date";case 45:return 30;case 46:return"accDescription";case 47:return 36;case 48:return 38;case 49:return 39;case 50:return":";case 51:return 6;case 52:return"INVALID"}},"anonymous"),rules:[/^(?:%%\{)/i,/^(?:accTitle\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*\{\s*)/i,/^(?:[\}])/i,/^(?:[^\}]*)/i,/^(?:%%(?!\{)*[^\n]*)/i,/^(?:[^\}]%%*[^\n]*)/i,/^(?:%%*[^\n]*[\n]*)/i,/^(?:[\n]+)/i,/^(?:\s+)/i,/^(?:%[^\n]*)/i,/^(?:href[\s]+["])/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:call[\s]+)/i,/^(?:\([\s]*\))/i,/^(?:\()/i,/^(?:[^(]*)/i,/^(?:\))/i,/^(?:[^)]*)/i,/^(?:click[\s]+)/i,/^(?:[\s\n])/i,/^(?:[^\s\n]*)/i,/^(?:gantt\b)/i,/^(?:dateFormat\s[^#\n;]+)/i,/^(?:inclusiveEndDates\b)/i,/^(?:topAxis\b)/i,/^(?:axisFormat\s[^#\n;]+)/i,/^(?:tickInterval\s[^#\n;]+)/i,/^(?:includes\s[^#\n;]+)/i,/^(?:excludes\s[^#\n;]+)/i,/^(?:todayMarker\s[^\n;]+)/i,/^(?:weekday\s+monday\b)/i,/^(?:weekday\s+tuesday\b)/i,/^(?:weekday\s+wednesday\b)/i,/^(?:weekday\s+thursday\b)/i,/^(?:weekday\s+friday\b)/i,/^(?:weekday\s+saturday\b)/i,/^(?:weekday\s+sunday\b)/i,/^(?:weekend\s+friday\b)/i,/^(?:weekend\s+saturday\b)/i,/^(?:\d\d\d\d-\d\d-\d\d\b)/i,/^(?:title\s[^\n]+)/i,/^(?:accDescription\s[^#\n;]+)/i,/^(?:section\s[^\n]+)/i,/^(?:[^:\n]+)/i,/^(?::[^#\n;]+)/i,/^(?::)/i,/^(?:$)/i,/^(?:.)/i],conditions:{acc_descr_multiline:{rules:[6,7],inclusive:!1},acc_descr:{rules:[4],inclusive:!1},acc_title:{rules:[2],inclusive:!1},callbackargs:{rules:[21,22],inclusive:!1},callbackname:{rules:[18,19,20],inclusive:!1},href:{rules:[15,16],inclusive:!1},click:{rules:[24,25],inclusive:!1},INITIAL:{rules:[0,1,3,5,8,9,10,11,12,13,14,17,23,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52],inclusive:!0}}};return D})();T.lexer=v;function m(){this.yy={}}return l(m,"Parser"),m.prototype=T,T.Parser=m,new m})();Rt.parser=Rt;var Yr=Rt;U.extend(Dr);U.extend(Mr);U.extend(Lr);var me={friday:5,saturday:6},tt="",Xt="",jt=void 0,Ut="",yt=[],pt=[],Zt=new Map,$t=[],At=[],ht="",Qt="",Me=["active","done","crit","milestone","vert"],Kt=[],gt=!1,Jt=!1,te="sunday",It="saturday",Bt=0,Wr=l(function(){$t=[],At=[],ht="",Kt=[],Ct=0,qt=void 0,St=void 0,H=[],tt="",Xt="",Qt="",jt=void 0,Ut="",yt=[],pt=[],gt=!1,Jt=!1,Bt=0,Zt=new Map,Xe(),te="sunday",It="saturday"},"clear"),zr=l(function(t){Xt=t},"setAxisFormat"),Vr=l(function(){return Xt},"getAxisFormat"),Or=l(function(t){jt=t},"setTickInterval"),Pr=l(function(){return jt},"getTickInterval"),Nr=l(function(t){Ut=t},"setTodayMarker"),Rr=l(function(){return Ut},"getTodayMarker"),Br=l(function(t){tt=t},"setDateFormat"),Hr=l(function(){gt=!0},"enableInclusiveEndDates"),qr=l(function(){return gt},"endDatesAreInclusive"),Gr=l(function(){Jt=!0},"enableTopAxis"),Xr=l(function(){return Jt},"topAxisEnabled"),jr=l(function(t){Qt=t},"setDisplayMode"),Ur=l(function(){return Qt},"getDisplayMode"),Zr=l(function(){return tt},"getDateFormat"),$r=l(function(t){yt=t.toLowerCase().split(/[\s,]+/)},"setIncludes"),Qr=l(function(){return yt},"getIncludes"),Kr=l(function(t){pt=t.toLowerCase().split(/[\s,]+/)},"setExcludes"),Jr=l(function(){return pt},"getExcludes"),ti=l(function(){return Zt},"getLinks"),ei=l(function(t){ht=t,$t.push(t)},"addSection"),ri=l(function(){return $t},"getSections"),ii=l(function(){let t=ke();const e=10;let r=0;for(;!t&&r<e;)t=ke(),r++;return At=H,At},"getTasks"),Ae=l(function(t,e,r,i){const a=t.format(e.trim()),h=t.format("YYYY-MM-DD");return i.includes(a)||i.includes(h)?!1:r.includes("weekends")&&(t.isoWeekday()===me[It]||t.isoWeekday()===me[It]+1)||r.includes(t.format("dddd").toLowerCase())?!0:r.includes(a)||r.includes(h)},"isInvalidDate"),ni=l(function(t){te=t},"setWeekday"),ai=l(function(){return te},"getWeekday"),si=l(function(t){It=t},"setWeekend"),Ie=l(function(t,e,r,i){if(!r.length||t.manualEndTime)return;let a;t.startTime instanceof Date?a=U(t.startTime):a=U(t.startTime,e,!0),a=a.add(1,"d");let h;t.endTime instanceof Date?h=U(t.endTime):h=U(t.endTime,e,!0);const[u,w]=oi(a,h,e,r,i);t.endTime=u.toDate(),t.renderEndTime=w},"checkTaskDates"),oi=l(function(t,e,r,i,a){let h=!1,u=null;for(;t<=e;)h||(u=e.toDate()),h=Ae(t,r,i,a),h&&(e=e.add(1,"d")),t=t.add(1,"d");return[e,u]},"fixTaskDates"),Ht=l(function(t,e,r){if(r=r.trim(),(e.trim()==="x"||e.trim()==="X")&&/^\d+$/.test(r))return new Date(Number(r));const a=/^after\s+(?<ids>[\d\w- ]+)/.exec(r);if(a!==null){let u=null;for(const E of a.groups.ids.split(" ")){let S=st(E);S!==void 0&&(!u||S.endTime>u.endTime)&&(u=S)}if(u)return u.endTime;const w=new Date;return w.setHours(0,0,0,0),w}let h=U(r,e.trim(),!0);if(h.isValid())return h.toDate();{Et.debug("Invalid date:"+r),Et.debug("With date format:"+e.trim());const u=new Date(r);if(u===void 0||isNaN(u.getTime())||u.getFullYear()<-1e4||u.getFullYear()>1e4)throw new Error("Invalid date:"+r);return u}},"getStartDate"),Fe=l(function(t){const e=/^(\d+(?:\.\d+)?)([Mdhmswy]|ms)$/.exec(t.trim());return e!==null?[Number.parseFloat(e[1]),e[2]]:[NaN,"ms"]},"parseDuration"),Le=l(function(t,e,r,i=!1){r=r.trim();const h=/^until\s+(?<ids>[\d\w- ]+)/.exec(r);if(h!==null){let g=null;for(const C of h.groups.ids.split(" ")){let b=st(C);b!==void 0&&(!g||b.startTime<g.startTime)&&(g=b)}if(g)return g.startTime;const F=new Date;return F.setHours(0,0,0,0),F}let u=U(r,e.trim(),!0);if(u.isValid())return i&&(u=u.add(1,"d")),u.toDate();let w=U(t);const[E,S]=Fe(r);if(!Number.isNaN(E)){const g=w.add(E,S);g.isValid()&&(w=g)}return w.toDate()},"getEndDate"),Ct=0,ft=l(function(t){return t===void 0?(Ct=Ct+1,"task"+Ct):t},"parseId"),ci=l(function(t,e){let r;e.substr(0,1)===":"?r=e.substr(1,e.length):r=e;const i=r.split(","),a={};ee(i,a,Me);for(let u=0;u<i.length;u++)i[u]=i[u].trim();let h="";switch(i.length){case 1:a.id=ft(),a.startTime=t.endTime,h=i[0];break;case 2:a.id=ft(),a.startTime=Ht(void 0,tt,i[0]),h=i[1];break;case 3:a.id=ft(i[0]),a.startTime=Ht(void 0,tt,i[1]),h=i[2];break}return h&&(a.endTime=Le(a.startTime,tt,h,gt),a.manualEndTime=U(h,"YYYY-MM-DD",!0).isValid(),Ie(a,tt,pt,yt)),a},"compileData"),li=l(function(t,e){let r;e.substr(0,1)===":"?r=e.substr(1,e.length):r=e;const i=r.split(","),a={};ee(i,a,Me);for(let h=0;h<i.length;h++)i[h]=i[h].trim();switch(i.length){case 1:a.id=ft(),a.startTime={type:"prevTaskEnd",id:t},a.endTime={data:i[0]};break;case 2:a.id=ft(),a.startTime={type:"getStartDate",startData:i[0]},a.endTime={data:i[1]};break;case 3:a.id=ft(i[0]),a.startTime={type:"getStartDate",startData:i[1]},a.endTime={data:i[2]};break}return a},"parseData"),qt,St,H=[],Ye={},ui=l(function(t,e){const r={section:ht,type:ht,processed:!1,manualEndTime:!1,renderEndTime:null,raw:{data:e},task:t,classes:[]},i=li(St,e);r.raw.startTime=i.startTime,r.raw.endTime=i.endTime,r.id=i.id,r.prevTaskId=St,r.active=i.active,r.done=i.done,r.crit=i.crit,r.milestone=i.milestone,r.vert=i.vert,r.order=Bt,Bt++;const a=H.push(r);St=r.id,Ye[r.id]=a-1},"addTask"),st=l(function(t){const e=Ye[t];return H[e]},"findTaskById"),di=l(function(t,e){const r={section:ht,type:ht,description:t,task:t,classes:[]},i=ci(qt,e);r.startTime=i.startTime,r.endTime=i.endTime,r.id=i.id,r.active=i.active,r.done=i.done,r.crit=i.crit,r.milestone=i.milestone,r.vert=i.vert,qt=r,At.push(r)},"addTaskOrg"),ke=l(function(){const t=l(function(r){const i=H[r];let a="";switch(H[r].raw.startTime.type){case"prevTaskEnd":{const h=st(i.prevTaskId);i.startTime=h.endTime;break}case"getStartDate":a=Ht(void 0,tt,H[r].raw.startTime.startData),a&&(H[r].startTime=a);break}return H[r].startTime&&(H[r].endTime=Le(H[r].startTime,tt,H[r].raw.endTime.data,gt),H[r].endTime&&(H[r].processed=!0,H[r].manualEndTime=U(H[r].raw.endTime.data,"YYYY-MM-DD",!0).isValid(),Ie(H[r],tt,pt,yt))),H[r].processed},"compileTask");let e=!0;for(const[r,i]of H.entries())t(r),e=e&&i.processed;return e},"compileTasks"),fi=l(function(t,e){let r=e;ut().securityLevel!=="loose"&&(r=Ge.sanitizeUrl(e)),t.split(",").forEach(function(i){st(i)!==void 0&&(ze(i,()=>{window.open(r,"_self")}),Zt.set(i,r))}),We(t,"clickable")},"setLink"),We=l(function(t,e){t.split(",").forEach(function(r){let i=st(r);i!==void 0&&i.classes.push(e)})},"setClass"),hi=l(function(t,e,r){if(ut().securityLevel!=="loose"||e===void 0)return;let i=[];if(typeof r=="string"){i=r.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);for(let h=0;h<i.length;h++){let u=i[h].trim();u.startsWith('"')&&u.endsWith('"')&&(u=u.substr(1,u.length-2)),i[h]=u}}i.length===0&&i.push(t),st(t)!==void 0&&ze(t,()=>{je.runFunc(e,...i)})},"setClickFun"),ze=l(function(t,e){Kt.push(function(){const r=document.querySelector(`[id="${t}"]`);r!==null&&r.addEventListener("click",function(){e()})},function(){const r=document.querySelector(`[id="${t}-text"]`);r!==null&&r.addEventListener("click",function(){e()})})},"pushFun"),mi=l(function(t,e,r){t.split(",").forEach(function(i){hi(i,e,r)}),We(t,"clickable")},"setClickEvent"),ki=l(function(t){Kt.forEach(function(e){e(t)})},"bindFunctions"),yi={getConfig:l(()=>ut().gantt,"getConfig"),clear:Wr,setDateFormat:Br,getDateFormat:Zr,enableInclusiveEndDates:Hr,endDatesAreInclusive:qr,enableTopAxis:Gr,topAxisEnabled:Xr,setAxisFormat:zr,getAxisFormat:Vr,setTickInterval:Or,getTickInterval:Pr,setTodayMarker:Nr,getTodayMarker:Rr,setAccTitle:Be,getAccTitle:Re,setDiagramTitle:Ne,getDiagramTitle:Pe,setDisplayMode:jr,getDisplayMode:Ur,setAccDescription:Oe,getAccDescription:Ve,addSection:ei,getSections:ri,getTasks:ii,addTask:ui,findTaskById:st,addTaskOrg:di,setIncludes:$r,getIncludes:Qr,setExcludes:Kr,getExcludes:Jr,setClickEvent:mi,setLink:fi,getLinks:ti,bindFunctions:ki,parseDuration:Fe,isInvalidDate:Ae,setWeekday:ni,getWeekday:ai,setWeekend:si};function ee(t,e,r){let i=!0;for(;i;)i=!1,r.forEach(function(a){const h="^\\s*"+a+"\\s*$",u=new RegExp(h);t[0].match(u)&&(e[a]=!0,t.shift(1),i=!0)})}l(ee,"getTaskTags");var pi=l(function(){Et.debug("Something is calling, setConf, remove the call")},"setConf"),ye={monday:sr,tuesday:ar,wednesday:nr,thursday:ir,friday:rr,saturday:er,sunday:tr},gi=l((t,e)=>{let r=[...t].map(()=>-1/0),i=[...t].sort((h,u)=>h.startTime-u.startTime||h.order-u.order),a=0;for(const h of i)for(let u=0;u<r.length;u++)if(h.startTime>=r[u]){r[u]=h.endTime,h.order=u+e,u>a&&(a=u);break}return a},"getMaxIntersections"),rt,vi=l(function(t,e,r,i){const a=ut().gantt,h=ut().securityLevel;let u;h==="sandbox"&&(u=bt("#i"+e));const w=h==="sandbox"?bt(u.nodes()[0].contentDocument.body):bt("body"),E=h==="sandbox"?u.nodes()[0].contentDocument:document,S=E.getElementById(e);rt=S.parentElement.offsetWidth,rt===void 0&&(rt=1200),a.useWidth!==void 0&&(rt=a.useWidth);const g=i.db.getTasks();let F=[];for(const p of g)F.push(p.type);F=O(F);const C={};let b=2*a.topPadding;if(i.db.getDisplayMode()==="compact"||a.displayMode==="compact"){const p={};for(const T of g)p[T.section]===void 0?p[T.section]=[T]:p[T.section].push(T);let _=0;for(const T of Object.keys(p)){const v=gi(p[T],_)+1;_+=v,b+=v*(a.barHeight+a.barGap),C[T]=v}}else{b+=g.length*(a.barHeight+a.barGap);for(const p of F)C[p]=g.filter(_=>_.type===p).length}S.setAttribute("viewBox","0 0 "+rt+" "+b);const q=w.select(`[id="${e}"]`),A=$e().domain([Qe(g,function(p){return p.startTime}),Ke(g,function(p){return p.endTime})]).rangeRound([0,rt-a.leftPadding-a.rightPadding]);function x(p,_){const T=p.startTime,v=_.startTime;let m=0;return T>v?m=1:T<v&&(m=-1),m}l(x,"taskCompare"),g.sort(x),M(g,rt,b),He(q,b,rt,a.useMaxWidth),q.append("text").text(i.db.getDiagramTitle()).attr("x",rt/2).attr("y",a.titleTopMargin).attr("class","titleText");function M(p,_,T){const v=a.barHeight,m=v+a.barGap,D=a.topPadding,c=a.leftPadding,f=Je().domain([0,F.length]).range(["#00B9FA","#F95002"]).interpolate(hr);Y(m,D,c,_,T,p,i.db.getExcludes(),i.db.getIncludes()),R(c,D,_,T),L(p,m,D,c,v,f,_),N(m,D),G(c,D,_,T)}l(M,"makeGantt");function L(p,_,T,v,m,D,c){p.sort((o,n)=>o.vert===n.vert?0:o.vert?1:-1);const k=[...new Set(p.map(o=>o.order))].map(o=>p.find(n=>n.order===o));q.append("g").selectAll("rect").data(k).enter().append("rect").attr("x",0).attr("y",function(o,n){return n=o.order,n*_+T-2}).attr("width",function(){return c-a.rightPadding/2}).attr("height",_).attr("class",function(o){for(const[n,W]of F.entries())if(o.type===W)return"section section"+n%a.numberSectionStyles;return"section section0"}).enter();const d=q.append("g").selectAll("rect").data(p).enter(),y=i.db.getLinks();if(d.append("rect").attr("id",function(o){return o.id}).attr("rx",3).attr("ry",3).attr("x",function(o){return o.milestone?A(o.startTime)+v+.5*(A(o.endTime)-A(o.startTime))-.5*m:A(o.startTime)+v}).attr("y",function(o,n){return n=o.order,o.vert?a.gridLineStartPadding:n*_+T}).attr("width",function(o){return o.milestone?m:o.vert?.08*m:A(o.renderEndTime||o.endTime)-A(o.startTime)}).attr("height",function(o){return o.vert?g.length*(a.barHeight+a.barGap)+a.barHeight*2:m}).attr("transform-origin",function(o,n){return n=o.order,(A(o.startTime)+v+.5*(A(o.endTime)-A(o.startTime))).toString()+"px "+(n*_+T+.5*m).toString()+"px"}).attr("class",function(o){const n="task";let W="";o.classes.length>0&&(W=o.classes.join(" "));let I=0;for(const[X,V]of F.entries())o.type===V&&(I=X%a.numberSectionStyles);let z="";return o.active?o.crit?z+=" activeCrit":z=" active":o.done?o.crit?z=" doneCrit":z=" done":o.crit&&(z+=" crit"),z.length===0&&(z=" task"),o.milestone&&(z=" milestone "+z),o.vert&&(z=" vert "+z),z+=I,z+=" "+W,n+z}),d.append("text").attr("id",function(o){return o.id+"-text"}).text(function(o){return o.task}).attr("font-size",a.fontSize).attr("x",function(o){let n=A(o.startTime),W=A(o.renderEndTime||o.endTime);if(o.milestone&&(n+=.5*(A(o.endTime)-A(o.startTime))-.5*m,W=n+m),o.vert)return A(o.startTime)+v;const I=this.getBBox().width;return I>W-n?W+I+1.5*a.leftPadding>c?n+v-5:W+v+5:(W-n)/2+n+v}).attr("y",function(o,n){return o.vert?a.gridLineStartPadding+g.length*(a.barHeight+a.barGap)+60:(n=o.order,n*_+a.barHeight/2+(a.fontSize/2-2)+T)}).attr("text-height",m).attr("class",function(o){const n=A(o.startTime);let W=A(o.endTime);o.milestone&&(W=n+m);const I=this.getBBox().width;let z="";o.classes.length>0&&(z=o.classes.join(" "));let X=0;for(const[P,Q]of F.entries())o.type===Q&&(X=P%a.numberSectionStyles);let V="";return o.active&&(o.crit?V="activeCritText"+X:V="activeText"+X),o.done?o.crit?V=V+" doneCritText"+X:V=V+" doneText"+X:o.crit&&(V=V+" critText"+X),o.milestone&&(V+=" milestoneText"),o.vert&&(V+=" vertText"),I>W-n?W+I+1.5*a.leftPadding>c?z+" taskTextOutsideLeft taskTextOutside"+X+" "+V:z+" taskTextOutsideRight taskTextOutside"+X+" "+V+" width-"+I:z+" taskText taskText"+X+" "+V+" width-"+I}),ut().securityLevel==="sandbox"){let o;o=bt("#i"+e);const n=o.nodes()[0].contentDocument;d.filter(function(W){return y.has(W.id)}).each(function(W){var I=n.querySelector("#"+W.id),z=n.querySelector("#"+W.id+"-text");const X=I.parentNode;var V=n.createElement("a");V.setAttribute("xlink:href",y.get(W.id)),V.setAttribute("target","_top"),X.appendChild(V),V.appendChild(I),V.appendChild(z)})}}l(L,"drawRects");function Y(p,_,T,v,m,D,c,f){if(c.length===0&&f.length===0)return;let k,d;for(const{startTime:I,endTime:z}of D)(k===void 0||I<k)&&(k=I),(d===void 0||z>d)&&(d=z);if(!k||!d)return;if(U(d).diff(U(k),"year")>5){Et.warn("The difference between the min and max time is more than 5 years. This will cause performance issues. Skipping drawing exclude days.");return}const y=i.db.getDateFormat(),s=[];let o=null,n=U(k);for(;n.valueOf()<=d;)i.db.isInvalidDate(n,y,c,f)?o?o.end=n:o={start:n,end:n}:o&&(s.push(o),o=null),n=n.add(1,"d");q.append("g").selectAll("rect").data(s).enter().append("rect").attr("id",I=>"exclude-"+I.start.format("YYYY-MM-DD")).attr("x",I=>A(I.start.startOf("day"))+T).attr("y",a.gridLineStartPadding).attr("width",I=>A(I.end.endOf("day"))-A(I.start.startOf("day"))).attr("height",m-_-a.gridLineStartPadding).attr("transform-origin",function(I,z){return(A(I.start)+T+.5*(A(I.end)-A(I.start))).toString()+"px "+(z*p+.5*m).toString()+"px"}).attr("class","exclude-range")}l(Y,"drawExcludeDays");function R(p,_,T,v){const m=i.db.getDateFormat(),D=i.db.getAxisFormat();let c;D?c=D:m==="D"?c="%d":c=a.axisFormat??"%Y-%m-%d";let f=xr(A).tickSize(-v+_+a.gridLineStartPadding).tickFormat(ie(c));const d=/^([1-9]\d*)(millisecond|second|minute|hour|day|week|month)$/.exec(i.db.getTickInterval()||a.tickInterval);if(d!==null){const y=d[1],s=d[2],o=i.db.getWeekday()||a.weekday;switch(s){case"millisecond":f.ticks(le.every(y));break;case"second":f.ticks(ce.every(y));break;case"minute":f.ticks(oe.every(y));break;case"hour":f.ticks(se.every(y));break;case"day":f.ticks(ae.every(y));break;case"week":f.ticks(ye[o].every(y));break;case"month":f.ticks(ne.every(y));break}}if(q.append("g").attr("class","grid").attr("transform","translate("+p+", "+(v-50)+")").call(f).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10).attr("dy","1em"),i.db.topAxisEnabled()||a.topAxis){let y=br(A).tickSize(-v+_+a.gridLineStartPadding).tickFormat(ie(c));if(d!==null){const s=d[1],o=d[2],n=i.db.getWeekday()||a.weekday;switch(o){case"millisecond":y.ticks(le.every(s));break;case"second":y.ticks(ce.every(s));break;case"minute":y.ticks(oe.every(s));break;case"hour":y.ticks(se.every(s));break;case"day":y.ticks(ae.every(s));break;case"week":y.ticks(ye[n].every(s));break;case"month":y.ticks(ne.every(s));break}}q.append("g").attr("class","grid").attr("transform","translate("+p+", "+_+")").call(y).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10)}}l(R,"makeGrid");function N(p,_){let T=0;const v=Object.keys(C).map(m=>[m,C[m]]);q.append("g").selectAll("text").data(v).enter().append(function(m){const D=m[0].split(qe.lineBreakRegex),c=-(D.length-1)/2,f=E.createElementNS("http://www.w3.org/2000/svg","text");f.setAttribute("dy",c+"em");for(const[k,d]of D.entries()){const y=E.createElementNS("http://www.w3.org/2000/svg","tspan");y.setAttribute("alignment-baseline","central"),y.setAttribute("x","10"),k>0&&y.setAttribute("dy","1em"),y.textContent=d,f.appendChild(y)}return f}).attr("x",10).attr("y",function(m,D){if(D>0)for(let c=0;c<D;c++)return T+=v[D-1][1],m[1]*p/2+T*p+_;else return m[1]*p/2+_}).attr("font-size",a.sectionFontSize).attr("class",function(m){for(const[D,c]of F.entries())if(m[0]===c)return"sectionTitle sectionTitle"+D%a.numberSectionStyles;return"sectionTitle"})}l(N,"vertLabels");function G(p,_,T,v){const m=i.db.getTodayMarker();if(m==="off")return;const D=q.append("g").attr("class","today"),c=new Date,f=D.append("line");f.attr("x1",A(c)+p).attr("x2",A(c)+p).attr("y1",a.titleTopMargin).attr("y2",v-a.titleTopMargin).attr("class","today"),m!==""&&f.attr("style",m.replace(/,/g,";"))}l(G,"drawToday");function O(p){const _={},T=[];for(let v=0,m=p.length;v<m;++v)Object.prototype.hasOwnProperty.call(_,p[v])||(_[p[v]]=!0,T.push(p[v]));return T}l(O,"checkUnique")},"draw"),bi={setConf:pi,draw:vi},xi=l(t=>`
  .mermaid-main-font {
        font-family: ${t.fontFamily};
  }

  .exclude-range {
    fill: ${t.excludeBkgColor};
  }

  .section {
    stroke: none;
    opacity: 0.2;
  }

  .section0 {
    fill: ${t.sectionBkgColor};
  }

  .section2 {
    fill: ${t.sectionBkgColor2};
  }

  .section1,
  .section3 {
    fill: ${t.altSectionBkgColor};
    opacity: 0.2;
  }

  .sectionTitle0 {
    fill: ${t.titleColor};
  }

  .sectionTitle1 {
    fill: ${t.titleColor};
  }

  .sectionTitle2 {
    fill: ${t.titleColor};
  }

  .sectionTitle3 {
    fill: ${t.titleColor};
  }

  .sectionTitle {
    text-anchor: start;
    font-family: ${t.fontFamily};
  }


  /* Grid and axis */

  .grid .tick {
    stroke: ${t.gridColor};
    opacity: 0.8;
    shape-rendering: crispEdges;
  }

  .grid .tick text {
    font-family: ${t.fontFamily};
    fill: ${t.textColor};
  }

  .grid path {
    stroke-width: 0;
  }


  /* Today line */

  .today {
    fill: none;
    stroke: ${t.todayLineColor};
    stroke-width: 2px;
  }


  /* Task styling */

  /* Default task */

  .task {
    stroke-width: 2;
  }

  .taskText {
    text-anchor: middle;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideRight {
    fill: ${t.taskTextDarkColor};
    text-anchor: start;
    font-family: ${t.fontFamily};
  }

  .taskTextOutsideLeft {
    fill: ${t.taskTextDarkColor};
    text-anchor: end;
  }


  /* Special case clickable */

  .task.clickable {
    cursor: pointer;
  }

  .taskText.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideLeft.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideRight.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }


  /* Specific task settings for the sections*/

  .taskText0,
  .taskText1,
  .taskText2,
  .taskText3 {
    fill: ${t.taskTextColor};
  }

  .task0,
  .task1,
  .task2,
  .task3 {
    fill: ${t.taskBkgColor};
    stroke: ${t.taskBorderColor};
  }

  .taskTextOutside0,
  .taskTextOutside2
  {
    fill: ${t.taskTextOutsideColor};
  }

  .taskTextOutside1,
  .taskTextOutside3 {
    fill: ${t.taskTextOutsideColor};
  }


  /* Active task */

  .active0,
  .active1,
  .active2,
  .active3 {
    fill: ${t.activeTaskBkgColor};
    stroke: ${t.activeTaskBorderColor};
  }

  .activeText0,
  .activeText1,
  .activeText2,
  .activeText3 {
    fill: ${t.taskTextDarkColor} !important;
  }


  /* Completed task */

  .done0,
  .done1,
  .done2,
  .done3 {
    stroke: ${t.doneTaskBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
  }

  .doneText0,
  .doneText1,
  .doneText2,
  .doneText3 {
    fill: ${t.taskTextDarkColor} !important;
  }


  /* Tasks on the critical line */

  .crit0,
  .crit1,
  .crit2,
  .crit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.critBkgColor};
    stroke-width: 2;
  }

  .activeCrit0,
  .activeCrit1,
  .activeCrit2,
  .activeCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.activeTaskBkgColor};
    stroke-width: 2;
  }

  .doneCrit0,
  .doneCrit1,
  .doneCrit2,
  .doneCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
    cursor: pointer;
    shape-rendering: crispEdges;
  }

  .milestone {
    transform: rotate(45deg) scale(0.8,0.8);
  }

  .milestoneText {
    font-style: italic;
  }
  .doneCritText0,
  .doneCritText1,
  .doneCritText2,
  .doneCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  .vert {
    stroke: ${t.vertLineColor};
  }

  .vertText {
    font-size: 15px;
    text-anchor: middle;
    fill: ${t.vertLineColor} !important;
  }

  .activeCritText0,
  .activeCritText1,
  .activeCritText2,
  .activeCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  .titleText {
    text-anchor: middle;
    font-size: 18px;
    fill: ${t.titleColor||t.textColor};
    font-family: ${t.fontFamily};
  }
`,"getStyles"),Ti=xi,rn={parser:Yr,db:yi,renderer:bi,styles:Ti};export{rn as diagram};
