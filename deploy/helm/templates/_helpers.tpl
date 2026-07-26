{{/*
Expand the name of the chart.
*/}}
{{- define "payswap.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a fully-qualified app name.
*/}}
{{- define "payswap.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Chart name and version label.
*/}}
{{- define "payswap.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels.
*/}}
{{- define "payswap.labels" -}}
helm.sh/chart: {{ include "payswap.chart" . }}
{{ include "payswap.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: payswap-platform
{{- end -}}

{{/*
Selector labels.
*/}}
{{- define "payswap.selectorLabels" -}}
app.kubernetes.io/name: {{ include "payswap.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: api
{{- end -}}

{{/*
Service account name.
*/}}
{{- define "payswap.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "payswap.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
Namespace.
*/}}
{{- define "payswap.namespace" -}}
{{- default .Release.Namespace .Values.namespace -}}
{{- end -}}
