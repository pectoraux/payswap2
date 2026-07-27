# =============================================================================
# PaySwap — Terraform input variables
# =============================================================================
# All inputs needed to provision the PaySwap production stack on AWS.
# Override via `-var` flags or a `terraform.tfvars` file.
# =============================================================================

variable "aws_region" {
  description = "AWS region for the primary deployment."
  type        = string
  default     = "us-east-1"
}

variable "aws_secondary_region" {
  description = "AWS region for the DR / multi-region deployment."
  type        = string
  default     = "eu-west-1"
}

variable "environment" {
  description = "Deployment environment (production, staging, dev)."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging", "dev"], var.environment)
    error_message = "environment must be one of: production, staging, dev."
  }
}

variable "project" {
  description = "Project name — used as a prefix for all resources."
  type        = string
  default     = "payswap"
}

variable "domain" {
  description = "Root domain for the deployment (e.g. payswap.io)."
  type        = string
  default     = "payswap.io"
}

variable "api_subdomain" {
  description = "Subdomain for the API (e.g. api → api.payswap.io)."
  type        = string
  default     = "api"
}

variable "dashboard_subdomain" {
  description = "Subdomain for the merchant dashboard."
  type        = string
  default     = "dashboard"
}

variable "cluster_version" {
  description = "Kubernetes version for the EKS cluster."
  type        = string
  default     = "1.30"
}

variable "node_instance_type" {
  description = "EC2 instance type for EKS worker nodes."
  type        = string
  default     = "m6i.large"
}

variable "node_min_size" {
  description = "Minimum number of worker nodes (per node group)."
  type        = number
  default     = 3
}

variable "node_max_size" {
  description = "Maximum number of worker nodes (per node group)."
  type        = number
  default     = 20
}

variable "node_desired_size" {
  description = "Desired number of worker nodes (per node group)."
  type        = number
  default     = 3
}

variable "rds_instance_class" {
  description = "RDS instance class for the primary PostgreSQL."
  type        = string
  default     = "db.r6g.large"
}

variable "rds_allocated_storage" {
  description = "Allocated storage for the RDS instance (GB)."
  type        = number
  default     = 200
}

variable "rds_multi_az" {
  description = "Enable RDS Multi-AZ for HA."
  type        = bool
  default     = true
}

variable "rds_backup_retention_days" {
  description = "RDS automated backup retention (days)."
  type        = number
  default     = 30
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type."
  type        = string
  default     = "cache.r6g.large"
}

variable "redis_cluster_size" {
  description = "Number of nodes in the Redis cluster (replication group)."
  type        = number
  default     = 3
}

variable "tags" {
  description = "Common tags applied to all resources."
  type        = map(string)
  default = {
    Project     = "payswap"
    ManagedBy   = "terraform"
    Owner       = "platform-team"
    CostCenter  = "engineering"
  }
}
