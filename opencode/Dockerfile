FROM php:8.2-apache

# Install OpenSSH server and python dependencies
RUN apt-get update && \
    apt-get install -y openssh-server python3 python3-pip python3-requests python3-bs4 curl git && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Allow pip to install packages globally (bypass PEP 668)
ENV PIP_BREAK_SYSTEM_PACKAGES=1

# Configure SSH
RUN mkdir -p /var/run/sshd && \
    sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config
# Create SSH user with secure password from environment
ARG SSH_USER=opencodeuser
ARG SSH_PASS
RUN if [ -z "$SSH_PASS" ]; then echo "SSH_PASS build argument is required" && exit 1; fi && \
    useradd -m -s /bin/bash $SSH_USER && \
    echo "$SSH_USER:$SSH_PASS" | chpasswd


# Expose SSH port
EXPOSE 22

# Start both Apache and SSH
COPY start-services.sh /start-services.sh
RUN chmod +x /start-services.sh
CMD ["/start-services.sh"]