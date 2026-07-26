# =============================================================================
# PaySwap — Terraform outputs
# =============================================================================
# Surfaces the key endpoints + ARNs needed by the application / CI.
# =============================================================================

output "cluster_name" {
  description = "Name of the EKS cluster."
  value       = aws_eks_cluster.main.name
}

output "cluster_endpoint" {
  description = "API endpoint for the EKS cluster."
  value       = aws_eks_cluster.main.endpoint
}

output "cluster_ca_certificate" {
  description = "Base64-encoded CA certificate for the EKS cluster."
  value       = aws_eks_cluster.main.certificate_authority[0].data
  sensitive   = true
}

output "cluster_version" {
  description = "Kubernetes version of the EKS cluster."
  value       = aws_eks_cluster.main.version
}

output "node_group_name" {
  description = "Name of the EKS managed node group."
  value       = aws_eks_node_group.main.node_group_name
}

output "rds_endpoint" {
  description = "Endpoint of the RDS PostgreSQL instance."
  value       = aws_db_instance.main.endpoint
}

output "rds_port" {
  description = "Port of the RDS PostgreSQL instance."
  value       = aws_db_instance.main.port
}

output "rds_db_name" {
  description = "Name of the RDS database."
  value       = aws_db_instance.main.db_name
}

output "rds_master_password_ssm_parameter" {
  description = "SSM Parameter Store name for the RDS master password."
  value       = aws_ssm_parameter.rds_master_password.name
  sensitive   = true
}

output "backups_bucket_name" {
  description = "Name of the S3 bucket for DR backups."
  value       = aws_s3_bucket.backups.id
}

output "assets_bucket_name" {
  description = "Name of the S3 bucket for static assets."
  value       = aws_s3_bucket.assets.id
}

output "ecr_repository_url" {
  description = "URL of the ECR repository for the PaySwap Docker image."
  value       = aws_ecr_repository.main.repository_url
}

output "cloudfront_domain_name" {
  description = "Domain name of the CloudFront distribution."
  value       = aws_cloudfront_distribution.main.domain_name
}

output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution (for cache invalidations)."
  value       = aws_cloudfront_distribution.main.id
}

output "waf_acl_arn" {
  description = "ARN of the WAFv2 web ACL."
  value       = aws_wafv2_web_acl.main.arn
}

output "route53_zone_id" {
  description = "Zone ID of the Route 53 hosted zone."
  value       = aws_route53_zone.main.zone_id
}

output "api_fqdn" {
  description = "Fully-qualified domain name of the API."
  value       = local.api_fqdn
}

output "dashboard_fqdn" {
  description = "Fully-qualified domain name of the merchant dashboard."
  value       = local.dashboard_fqdn
}

output "vpc_id" {
  description = "ID of the VPC."
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets."
  value       = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets."
  value       = aws_subnet.public[*].id
}

output "database_subnet_ids" {
  description = "IDs of the database subnets."
  value       = aws_subnet.database[*].id
}
