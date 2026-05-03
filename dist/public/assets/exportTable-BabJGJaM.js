import{c as h}from"./safeDate-CRF-1jSb.js";function f(e){if(e==null)return"";if(typeof e=="number")return String(e);if(typeof e=="boolean")return e?"是":"否";if(e instanceof Date)return h(e);const o=String(e);return o.includes(",")||o.includes(`
`)||o.includes('"')?`"${o.replace(/"/g,'""')}"`:o}function g(e){const{filename:o,columns:s,data:a}=e,r=s.map(n=>f(n.label)).join(","),i=a.map(n=>s.map(u=>f(n[u.key])).join(",")),m="\uFEFF"+[r,...i].join(`
`),d=new Blob([m],{type:"text/csv;charset=utf-8;"}),c=URL.createObjectURL(d),t=document.createElement("a");t.href=c,t.download=`${o}.csv`,document.body.appendChild(t),t.click(),document.body.removeChild(t),URL.revokeObjectURL(c)}function S(e){const{filename:o,columns:s,data:a}=e,r=n=>n.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;"),i=s.map(n=>`<Cell ss:StyleID="Header"><Data ss:Type="String">${r(n.label)}</Data></Cell>`).join(""),p=a.map(n=>`<Row>${s.map(b=>{const l=n[b.key],y=typeof l=="number"?"Number":"String",C=l==null?"":String(l);return`<Cell><Data ss:Type="${y}">${r(C)}</Data></Cell>`}).join("")}</Row>`).join(`
`),m=`<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#CCCCCC" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="数据">
    <Table>
      <Row>${i}</Row>
      ${p}
    </Table>
  </Worksheet>
</Workbook>`,d=new Blob([m],{type:"application/vnd.ms-excel;charset=utf-8;"}),c=URL.createObjectURL(d),t=document.createElement("a");t.href=c,t.download=`${o}.xls`,document.body.appendChild(t),t.click(),document.body.removeChild(t),URL.revokeObjectURL(c)}function x(e){e.format==="csv"?g(e):S(e)}export{x as exportTable,g as exportToCSV,S as exportToExcel};
